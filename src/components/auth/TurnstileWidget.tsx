import React, { useEffect, useRef } from 'react';
import { loadTurnstileScript } from '../../utils/turnstile';

interface TurnstileWidgetProps {
  siteKey: string;
  /** Called with a fresh token, or null when it expires or fails. */
  onToken: (token: string | null) => void;
}

/**
 * Cloudflare Turnstile (free, mostly invisible) bot check.
 * বাংলা: বেশিরভাগ সময় কিছুই দেখায় না — সন্দেহ হলে শুধু একটা ছোট চেকবক্স আসে।
 * টোকেন একবারই ব্যবহার করা যায়, তাই প্রতিটি সাবমিটের পর প্যারেন্ট `key` বদলে নতুন widget বানায়।
 */
export const TurnstileWidget: React.FC<TurnstileWidgetProps> = ({ siteKey, onToken }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;

    loadTurnstileScript()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        widgetId = api.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'auto',
          appearance: 'interaction-only',
          size: 'flexible',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // widget already gone
        }
      }
    };
  }, [siteKey]);

  return <div ref={containerRef} data-testid="turnstile-widget" className="flex justify-center" />;
};
