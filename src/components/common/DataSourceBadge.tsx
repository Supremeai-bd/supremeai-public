import React from 'react';

/**
 * বাংলা মন্তব্য: admin কনসোলের সবচেয়ে বড় সমস্যা হলো — ভিউ নিজে থেকে বলে না, যে ডেটা
 * সে দেখাচ্ছে সেটা লাইভ সার্ভার থেকে এসেছে, নাকি `src/data/*`-এর স্ট্যাটিক ডেমো।
 * আগে ব্যবহারকারীকে এটা জানার কোনো উপায়ই ছিল না, ফলে ডেমো সংখ্যাকেও আসল ভাবা যেত।
 *
 * এই কম্পোনেন্ট ইচ্ছাকৃতভাবে সাধারণ রাখা হয়েছে: রঙ + লেবেল + টুলটিপ। কোনো ভিউ
 * নিজের পছন্দমতো রঙ বাছতে পারবে না, তাই সব জায়গায় একই অর্থ দাঁড়াবে।
 */
export type DataSourceKind = 'live' | 'demo' | 'degraded' | 'unknown';

export interface DataSourceBadgeProps {
  /** ডেটা কোথা থেকে এসেছে */
  source: DataSourceKind;
  /** কেন এই অবস্থা — hover করলে দেখাবে। বাধ্যতামূলক, যাতে ব্যাজটা সবসময় ব্যাখ্যা দেয় */
  reason: string;
  /** ডেটা কতক্ষণ আগের (ঐচ্ছিক) */
  ageMs?: number;
  className?: string;
}

interface BadgeStyle {
  label: string;
  className: string;
  title: string;
}

const STYLES: Record<DataSourceKind, BadgeStyle> = {
  live: {
    label: 'LIVE',
    className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
    title: 'এই ভিউয়ের ডেটা লাইভ সার্ভার API থেকে এসেছে।',
  },
  demo: {
    label: 'DEMO',
    className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40',
    title: 'এই ভিউয়ের ডেটা src/data/* এর স্ট্যাটিক নমুনা — আসল সার্ভার ডেটা নয়।',
  },
  degraded: {
    label: 'DEGRADED',
    className: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/40',
    title: 'লাইভ API-তে পৌঁছানো যায়নি; ফলব্যাক ডেটা দেখানো হচ্ছে।',
  },
  unknown: {
    label: 'UNKNOWN',
    className: 'bg-slate-500/15 text-slate-500 dark:text-slate-400 border-slate-500/40',
    title: 'ডেটার উৎস এখনো নির্ধারিত হয়নি (লোড হচ্ছে বা অনুরোধ ব্যর্থ)।',
  },
};

/** বাংলা মন্তব্য: "কতক্ষণ আগে" — ইনপুট ছাড়া কখনো ভুয়া সংখ্যা দেখাবে না */
function formatAge(ageMs?: number): string | null {
  if (typeof ageMs !== 'number' || !Number.isFinite(ageMs) || ageMs < 0) return null;
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s আগে`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m আগে`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h আগে`;
  return `${Math.floor(hours / 24)}d আগে`;
}

export const DataSourceBadge: React.FC<DataSourceBadgeProps> = ({
  source,
  reason,
  ageMs,
  className = '',
}) => {
  const style = STYLES[source];
  const age = formatAge(ageMs);

  return (
    <span
      // বাংলা মন্তব্য: role="status" + aria-live — স্ক্রিন রিডার ব্যবহারকারীও উৎসের পরিবর্তন জানবে
      role="status"
      aria-live="polite"
      data-testid="data-source-badge"
      data-source={source}
      title={`${style.title}\n\n${reason}`}
      className={[
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border',
        'text-[10px] font-semibold tracking-wide uppercase select-none',
        style.className,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'w-1.5 h-1.5 rounded-full',
          source === 'live'
            ? 'bg-emerald-500'
            : source === 'demo'
              ? 'bg-amber-500'
              : source === 'degraded'
                ? 'bg-orange-500'
                : 'bg-slate-400',
        ].join(' ')}
      />
      {style.label}
      {age ? <span className="opacity-70 font-normal normal-case">· {age}</span> : null}
    </span>
  );
};

export default DataSourceBadge;
