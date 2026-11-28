import type { ChatAttachment, ChatMessage, ChatSession } from '../types';

export const MAX_CHAT_ATTACHMENTS = 4;
export const MAX_RAW_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB pre-compression limit
export const MAX_RAW_FILE_BYTES = 10 * 1024 * 1024; // 10 MB non-image file limit
export const MAX_IMAGE_DIMENSION = 1600;
const SOFT_PNG_BYTE_BUDGET = 1_400_000;

export function isImageAttachment(att?: Pick<ChatAttachment, 'mimeType' | 'data'> | null): boolean {
  if (!att) return false;
  const mime = String(att.mimeType || '').toLowerCase();
  const data = String(att.data || '');
  return mime.startsWith('image/') || data.startsWith('data:image/');
}

export function getMessageAttachments(
  msg?: Pick<ChatMessage, 'attachment' | 'attachments'> | null
): ChatAttachment[] {
  if (!msg) return [];
  const list: ChatAttachment[] = [];
  const seen = new Set<string>();

  const pushUnique = (item?: ChatAttachment | null) => {
    if (!item || !item.name) return;
    const key = `${item.name}::${item.mimeType}::${(item.data || '').slice(0, 64)}::${(item.data || '').length}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(item);
  };

  if (Array.isArray(msg.attachments)) {
    for (const item of msg.attachments) {
      pushUnique(item);
    }
  }
  if (msg.attachment) {
    pushUnique(msg.attachment);
  }
  return list;
}

export function normalizeAttachmentPayload(
  attachments?: ChatAttachment[] | null,
  single?: ChatAttachment | null
): { attachment?: ChatAttachment; attachments?: ChatAttachment[] } {
  const combined = getMessageAttachments({
    attachment: single || undefined,
    attachments: attachments || undefined,
  });
  if (combined.length === 0) return {};
  if (combined.length === 1) {
    return { attachment: combined[0] };
  }
  return {
    attachment: combined[0],
    attachments: combined,
  };
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  if (typeof FileReader === 'undefined') {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let base64: string;
    if (typeof Buffer !== 'undefined') {
      base64 = Buffer.from(bytes).toString('base64');
    } else {
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64 = btoa(binary);
    }
    const mime = file.type || 'application/octet-stream';
    return `data:${mime};base64,${base64}`;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read file "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image for optimization.'));
    img.src = src;
  });
}

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return Math.floor(base64.length * 0.75);
}

export async function optimizeImageFile(file: File): Promise<ChatAttachment> {
  if (file.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error(`Image "${file.name}" exceeds the 20 MB maximum size limit.`);
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const rawMime = (file.type || 'image/png').toLowerCase();

  // Preserve animated GIFs under 4 MB without flattening frames
  if (rawMime === 'image/gif' && file.size <= 4 * 1024 * 1024) {
    return {
      name: file.name || 'image.gif',
      mimeType: 'image/gif',
      data: rawDataUrl,
    };
  }

  // Fallback gracefully in non-DOM / SSR / test environments without canvas
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return {
      name: file.name || 'image.png',
      mimeType: rawMime,
      data: rawDataUrl,
    };
  }

  try {
    const img = await loadImageElement(rawDataUrl);
    const naturalW = img.naturalWidth || img.width || 0;
    const naturalH = img.naturalHeight || img.height || 0;
    if (naturalW <= 0 || naturalH <= 0) {
      return {
        name: file.name || 'image.png',
        mimeType: rawMime === 'image/svg+xml' ? 'image/png' : rawMime,
        data: rawDataUrl,
      };
    }

    const longestEdge = Math.max(naturalW, naturalH);
    const needsResize = longestEdge > MAX_IMAGE_DIMENSION;
    const isSvg = rawMime === 'image/svg+xml';
    const rawApproxBytes = estimateDataUrlBytes(rawDataUrl);

    // If already compact raster and within max dimension, keep original bytes untouched
    if (!needsResize && !isSvg && rawApproxBytes <= SOFT_PNG_BYTE_BUDGET) {
      return {
        name: file.name || 'image.png',
        mimeType: rawMime,
        data: rawDataUrl,
      };
    }

    const scale = needsResize ? MAX_IMAGE_DIMENSION / longestEdge : 1;
    const targetW = Math.max(1, Math.round(naturalW * scale));
    const targetH = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        name: file.name || 'image.png',
        mimeType: rawMime,
        data: rawDataUrl,
      };
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const preferPng = isSvg || rawMime === 'image/png';
    if (preferPng) {
      const pngUrl = canvas.toDataURL('image/png');
      if (estimateDataUrlBytes(pngUrl) <= SOFT_PNG_BYTE_BUDGET) {
        const cleanName = isSvg
          ? (file.name || 'diagram').replace(/\.svg$/i, '.png')
          : file.name || 'image.png';
        return {
          name: cleanName,
          mimeType: 'image/png',
          data: pngUrl,
        };
      }
    }

    // Use white background before JPEG export so transparent PNGs don't turn black
    if (preferPng || rawMime === 'image/webp') {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.globalCompositeOperation = 'source-over';
    }

    let jpegUrl = canvas.toDataURL('image/jpeg', 0.86);
    if (estimateDataUrlBytes(jpegUrl) > 2_600_000) {
      jpegUrl = canvas.toDataURL('image/jpeg', 0.74);
    }

    return {
      name: file.name || 'image.jpg',
      mimeType: 'image/jpeg',
      data: jpegUrl,
    };
  } catch {
    return {
      name: file.name || 'image.png',
      mimeType: rawMime,
      data: rawDataUrl,
    };
  }
}

export async function processSelectedFiles(
  files: File[],
  existingCount: number = 0
): Promise<{ attachments: ChatAttachment[]; errors: string[] }> {
  const attachments: ChatAttachment[] = [];
  const errors: string[] = [];

  const remainingSlots = Math.max(0, MAX_CHAT_ATTACHMENTS - existingCount);
  if (remainingSlots === 0 && files.length > 0) {
    return {
      attachments: [],
      errors: [`Maximum ${MAX_CHAT_ATTACHMENTS} attachments allowed per message.`],
    };
  }

  const slice = files.slice(0, remainingSlots);
  if (files.length > remainingSlots) {
    errors.push(`Only ${MAX_CHAT_ATTACHMENTS} attachments allowed per message.`);
  }

  for (const file of slice) {
    const isImage =
      file.type.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|bmp|svg|heic|avif)$/i.test(file.name);

    try {
      if (isImage) {
        const optimized = await optimizeImageFile(file);
        attachments.push(optimized);
      } else {
        if (file.size > MAX_RAW_FILE_BYTES) {
          errors.push(`File "${file.name}" exceeds the 10 MB limit.`);
          continue;
        }
        const dataUrl = await readFileAsDataUrl(file);
        attachments.push({
          name: file.name || 'attachment',
          mimeType: file.type || 'text/plain',
          data: dataUrl,
        });
      }
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : `Failed to process "${file.name}".`);
    }
  }

  return { attachments, errors };
}

/**
 * Fallback serializer used only when localStorage hits QuotaExceededError.
 * Preserves all conversation text and recent attachments while stripping bulky
 * base64 blobs from older historical messages.
 */
export function pruneSessionsForStorage(sessions: ChatSession[]): ChatSession[] {
  return sessions.map((session) => {
    const total = session.messages.length;
    return {
      ...session,
      messages: session.messages.map((msg, idx) => {
        const isRecent = idx >= total - 2;
        if (isRecent) return msg;

        const stripBlob = (att?: ChatAttachment): ChatAttachment | undefined => {
          if (!att) return undefined;
          if (!att.data || att.data.length <= 2048) return att;
          return {
            name: att.name,
            mimeType: att.mimeType,
            data: '',
          };
        };

        return {
          ...msg,
          ...(msg.attachment ? { attachment: stripBlob(msg.attachment) } : {}),
          ...(Array.isArray(msg.attachments)
            ? {
                attachments: msg.attachments
                  .map((a) => stripBlob(a))
                  .filter((a): a is ChatAttachment => Boolean(a)),
              }
            : {}),
        };
      }),
    };
  });
}
