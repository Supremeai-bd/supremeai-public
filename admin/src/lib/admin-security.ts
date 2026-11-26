import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const ADMIN_SESSION_COOKIE = "supremeai_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

// বাংলা মন্তব্য: P0 নিরাপত্তা শক্তিশালীকরণ — এই মডিউল এখন সম্পূর্ণ fail-closed।
// কোনো হার্ডকোডেড বা ডিফল্ট সিক্রেট নেই; সিক্রেট শুধুমাত্র এনভায়রনমেন্ট ভেরিয়েবল
// থেকে আসে এবং ন্যূনতম ৩২ অক্ষর হতে হবে। কনফিগার না থাকলে সব অ্যাডমিন প্রমাণীকরণ
// ব্যর্থ হবে। পূর্ববর্তী কোডে "njel.com.bd" ব্যাকডোর ছিল — verifyAdminAccessToken
// সবসময় সত্য ফেরত দিত এবং সেশন কুকি পাবলিক সিক্রেট দিয়ে সাইন হতো।
const MINIMUM_SECRET_LENGTH = 32;

function configuredSecret(): string | null {
  const secret =
    process.env.ADMIN_ACCESS_TOKEN?.trim() ||
    process.env.SUPREMEAI_ADMIN_TOKEN?.trim() ||
    process.env.ADMIN_PASSWORD?.trim() ||
    "";
  return secret.length >= MINIMUM_SECRET_LENGTH ? secret : null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function sessionSignature(expiresAt: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${ADMIN_SESSION_COOKIE}:${expiresAt}`)
    .digest("base64url");
}

export function adminAuthConfigured(): boolean {
  return configuredSecret() !== null;
}

export function verifyAdminAccessToken(candidate: string): boolean {
  const secret = configuredSecret();
  if (!secret) return false;
  const clean = candidate.trim();
  if (!clean) return false;
  return constantTimeEqual(clean, secret);
}

export function createAdminSessionCookieValue(): string | null {
  const secret = configuredSecret();
  if (!secret) return null;
  const expiresAt = String(Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS);
  return `${expiresAt}.${sessionSignature(expiresAt, secret)}`;
}

export function hasAdminSession(request: NextRequest): boolean {
  const secret = configuredSecret();
  if (!secret) return false;
  const value = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!value) return false;

  const [expiresAt, signature, extra] = value.split(".");
  if (!expiresAt || !signature || extra || !/^\d+$/.test(expiresAt)) return false;
  const expiresAtSeconds = Number(expiresAt);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (expiresAtSeconds <= nowSeconds) return false;
  // Defense in depth: a session cookie may never outlive its issued TTL window,
  // even when the signature is valid (limits replay of long-lived values).
  if (expiresAtSeconds > nowSeconds + ADMIN_SESSION_TTL_SECONDS + 60) return false;
  return constantTimeEqual(signature, sessionSignature(expiresAt, secret));
}
