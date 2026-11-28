/**
 * Standard 5-field cron evaluator (`minute hour day-of-month month day-of-week`)
 * Shared across Express auto-runner and browser Workspace Schedule tab.
 */

function parseCronToken(
  token: string,
  min: number,
  max: number,
  normalizeDayOfWeek: boolean = false
): Set<number> {
  const result = new Set<number>();
  const clean = token.trim();
  if (!clean) return result;

  const segments = clean.split(',');
  for (const segment of segments) {
    const part = segment.trim();
    if (!part) continue;

    const [rangeRaw, stepRaw] = part.split('/');
    const step = stepRaw ? Math.max(1, parseInt(stepRaw, 10) || 1) : 1;

    let start: number;
    let end: number;

    if (rangeRaw === '*') {
      start = min;
      end = max;
    } else if (rangeRaw.includes('-')) {
      const [aRaw, bRaw] = rangeRaw.split('-');
      const a = parseInt(aRaw, 10);
      const b = parseInt(bRaw, 10);
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      start = Math.max(min, a);
      end = Math.min(max, b);
    } else {
      const single = parseInt(rangeRaw, 10);
      if (Number.isNaN(single)) continue;
      const mapped = normalizeDayOfWeek && single === 7 ? 0 : single;
      if (mapped >= min && mapped <= max) {
        result.add(mapped);
      }
      continue;
    }

    if (start > end) continue;
    for (let val = start; val <= end; val += step) {
      const mapped = normalizeDayOfWeek && val === 7 ? 0 : val;
      if (mapped >= min && mapped <= max) {
        result.add(mapped);
      }
    }
  }

  return result;
}

export function isValidCronExpression(cronExpr: string): boolean {
  const fields = (cronExpr || '').trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minF, hourF, domF, monthF, dowF] = fields;
  return (
    parseCronToken(minF, 0, 59).size > 0 &&
    parseCronToken(hourF, 0, 23).size > 0 &&
    parseCronToken(domF, 1, 31).size > 0 &&
    parseCronToken(monthF, 1, 12).size > 0 &&
    parseCronToken(dowF, 0, 7, true).size > 0
  );
}

export function matchesCronAtDate(cronExpr: string, date: Date = new Date()): boolean {
  const fields = (cronExpr || '').trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minF, hourF, domF, monthF, dowF] = fields;

  const mins = parseCronToken(minF, 0, 59);
  const hours = parseCronToken(hourF, 0, 23);
  const doms = parseCronToken(domF, 1, 31);
  const months = parseCronToken(monthF, 1, 12);
  const dows = parseCronToken(dowF, 0, 7, true);

  if (
    mins.size === 0 ||
    hours.size === 0 ||
    doms.size === 0 ||
    months.size === 0 ||
    dows.size === 0
  ) {
    return false;
  }

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();

  return mins.has(minute) && hours.has(hour) && months.has(month) && doms.has(dom) && dows.has(dow);
}

export function getCronMinuteKey(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}
