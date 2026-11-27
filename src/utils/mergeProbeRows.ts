/**
 * বাংলা মন্তব্য: Probe All ব্যাচে চলে, আর প্রতিটা ব্যাচ আলাদা Cloudflare isolate-এ যেতে পারে
 * (প্রোব ক্যাশ শেয়ার হয় না)। পরের ব্যাচ কোনো কী-কে "untested" বললে আগের ব্যাচের রায় রাখা হয়।
 */
export function mergeProbeRows<T extends { id: string; status: string }>(
  prev: T[] | undefined,
  next: T[] | undefined
): T[] | undefined {
  if (!next) return prev;
  if (!prev) return next;
  const before = new Map(prev.map((row) => [row.id, row]));
  return next.map((row) => {
    const old = before.get(row.id);
    return row.status === 'untested' && old && old.status !== 'untested' ? old : row;
  });
}
