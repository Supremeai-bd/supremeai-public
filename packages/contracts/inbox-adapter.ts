/**
 * InboxAdapter — প্রতিটি চ্যানেল একই কন্ট্র্যাক্ট মানবে।
 * বাংলা মন্তব্য: নতুন চ্যানেল = শুধু নতুন অ্যাডাপ্টার, UniversalInboxPanel
 * ৫৭৩-লাইনের একটা ফাইলে সব লজিক রাখবে না। কন্ট্র্যাক্ট packages/contracts-এ
 * যাতে Web/Desktop/Android/VS Code সবাই একই টাইপ ব্যবহার করে।
 *
 * Phase 0: টাইপ + অ্যাডাপ্টার ইন্টারফেস মাত্র। Gmail অ্যাডাপ্টার বিদ্যমান
 * gmailOAuthService ঘিরে পরবর্তী ধাপে বসবে; অন্য চ্যানেল local-webview।
 */

export type ChannelType =
  | 'gmail'
  | 'telegram'
  | 'whatsapp'
  | 'messenger'
  | 'instagram';

/** cloud-oauth = সার্ভার-সাইড টোকেন (Gmail); local-webview = Tauri লোকাল ব্রিজ */
export type ChannelMode = 'cloud-oauth' | 'local-webview';

export interface InboxItem {
  id: string;
  channel: ChannelType;
  sender: string;
  subject: string;
  snippet: string;
  timestamp: string;
  unread: boolean;
}

export interface InboxItemDetail extends InboxItem {
  body?: string;
  /** উত্তর দেওয়ার জন্য প্রয়োজনীয় চ্যানেল-নির্ভর রেফারেন্স */
  replyRef?: string;
}

export interface InboxListOptions {
  cursor?: string;
  query?: string;
  limit?: number;
}

export interface InboxAvailability {
  ok: boolean;
  /** ok=false হলে UI-তে সৎ কারণ (যেমন "Local Desktop Sandbox প্রয়োজন") */
  reason?: string;
}

/**
 * প্রতিটি চ্যানেলের অ্যাডাপ্টার এই ইন্টারফেস মানবে।
 * নতুন চ্যানেল যোগ করলে শুধু একটা ক্লাস/ফাংশন লিখলেই হবে।
 */
export interface InboxAdapter {
  readonly channel: ChannelType;
  readonly mode: ChannelMode;
  isAvailable(): Promise<InboxAvailability>;
  list(opts?: InboxListOptions): Promise<InboxItem[]>;
  detail(id: string): Promise<InboxItemDetail>;
}

/** রেজিস্ট্রি: channel → adapter (UI শুধু এই ম্যাপ থেকে লোড করে) */
export type InboxAdapterRegistry = Readonly<
  Partial<Record<ChannelType, InboxAdapter>>
>;
