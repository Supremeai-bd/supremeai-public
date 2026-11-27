import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataSourceBadge } from './DataSourceBadge';

afterEach(cleanup);

describe('DataSourceBadge', () => {
  it('LIVE দেখায় যখন ডেটা লাইভ সোর্স থেকে আসে', () => {
    render(<DataSourceBadge source="live" reason="লাইভ API" />);
    const badge = screen.getByTestId('data-source-badge');
    expect(badge).toHaveAttribute('data-source', 'live');
    expect(badge).toHaveTextContent('LIVE');
  });

  it('DEMO দেখায় স্ট্যাটিক ডেটার জন্য — এটাই মূল উদ্দেশ্য', () => {
    render(<DataSourceBadge source="demo" reason="src/data থেকে" />);
    expect(screen.getByTestId('data-source-badge')).toHaveTextContent('DEMO');
  });

  it('DEGRADED ও UNKNOWN আলাদা করে চেনা যায়', () => {
    const { rerender } = render(<DataSourceBadge source="degraded" reason="API ব্যর্থ" />);
    expect(screen.getByTestId('data-source-badge')).toHaveTextContent('DEGRADED');
    rerender(<DataSourceBadge source="unknown" reason="লোড হয়নি" />);
    expect(screen.getByTestId('data-source-badge')).toHaveTextContent('UNKNOWN');
  });

  it('reason সবসময় টুলটিপে থাকে — ব্যাজ কখনো ব্যাখ্যা ছাড়া নয়', () => {
    render(<DataSourceBadge source="demo" reason="মক মোড চালু" />);
    expect(screen.getByTestId('data-source-badge')).toHaveAttribute(
      'title',
      expect.stringContaining('মক মোড চালু'),
    );
  });

  it('বয়স দেখায়, কিন্তু অবৈধ মানে ভুয়া সংখ্যা দেখায় না', () => {
    const { rerender } = render(<DataSourceBadge source="live" reason="ok" ageMs={90_000} />);
    expect(screen.getByTestId('data-source-badge')).toHaveTextContent('1m আগে');
    rerender(<DataSourceBadge source="live" reason="ok" ageMs={-5} />);
    expect(screen.getByTestId('data-source-badge')).not.toHaveTextContent('আগে');
    rerender(<DataSourceBadge source="live" reason="ok" ageMs={Number.NaN} />);
    expect(screen.getByTestId('data-source-badge')).not.toHaveTextContent('আগে');
  });

  it('স্ক্রিন রিডারের জন্য status role বহন করে', () => {
    render(<DataSourceBadge source="live" reason="ok" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
