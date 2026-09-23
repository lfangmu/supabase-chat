/**
 * Date utility functions for REQ-005 (message date separators)
 */

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** Format a date for separator display: 今天/昨天/X月X日 星期X/YYYY年X月X日 星期X */
export function formatDateSeparator(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000));

  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = WEEKDAYS[date.getDay()];

  if (diffDays === 0) {
    return '今天';
  }
  if (diffDays === 1) {
    return '昨天';
  }

  // Same year: X月X日 星期X
  if (date.getFullYear() === now.getFullYear()) {
    return `${month}月${day}日 ${weekday}`;
  }

  // Different year: YYYY年X月X日 星期X
  return `${date.getFullYear()}年${month}月${day}日 ${weekday}`;
}

/**
 * Format a Date as locale-independent 24-hour HH:mm.
 * Avoids toLocaleTimeString() quirks where the output format depends on the
 * browser's default locale / hour12 setting (e.g. "11:00 AM", "上午11:00",
 * or even malformed "110:" on some system locales).
 */
export function formatClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Get a date key (YYYY-MM-DD) from a timestamp for separator deduplication */
export function getDateKey(timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Check if two timestamps are on the same day */
export function isSameDay(a: string, b: string): boolean {
  return getDateKey(a) === getDateKey(b);
}

/** Format a friendly date label for separator display from a timestamp string */
export function formatDateSeparatorFromTimestamp(timestamp: string): string {
  return formatDateSeparator(new Date(timestamp));
}
