// ── Pipeline: 工具函数 ──────────────────────────────────

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function htmlToText(s) {
  let t = (s || '')
    .replace(/&nbsp;/g, ' ').replace(/&#160;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  t = t.replace(/<a\b[^>]*>/gi, '').replace(/<\/a\s*>/gi, '');
  t = t.replace(/<li\b[^>]*>/gi, ' · ').replace(/<\/li\s*>/gi, '');
  t = t.replace(/<ol\b[^>]*>/gi, '').replace(/<\/ol\s*>/gi, '');
  t = t.replace(/<ul\b[^>]*>/gi, '').replace(/<\/ul\s*>/gi, '');
  t = t.replace(/<br\b[^>]*\/?>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

export function stripCDATA(s) {
  return (s || '').replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

// Render news timestamps in Beijing time regardless of where the build runs
// (GitHub Actions runs in UTC — using the server's local time would show
// afternoon news as 08:xx). Format "08-07 16:02".
export function formatTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const bj = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const m = String(bj.getMonth() + 1).padStart(2, '0');
  const day = String(bj.getDate()).padStart(2, '0');
  const hh = String(bj.getHours()).padStart(2, '0');
  const mm = String(bj.getMinutes()).padStart(2, '0');
  return `${m}-${day} ${hh}:${mm}`;
}

// Parse a "YYYY-MM-DD HH:mm:ss" string that a source publishes in Beijing time as
// an absolute instant. new Date(str) interprets it in the *host's* local timezone
// — on CI (UTC container) that shifts every headline +8h into "the future", while
// locally (Beijing) it happens to be right. Interpreting the wall-clock as
// Asia/Shanghai (fixed UTC+8, no DST) is correct everywhere.
export function parseBeijingTime(value, fallback = Date.now()) {
  if (value === undefined || value === null || value === '') return new Date(fallback);
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value));
  if (!m) return new Date(value);
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)) - 8 * 3600 * 1000);
}

// Report date always follows Beijing time — GitHub Actions runs in UTC, so the
// naive local date would drift a day off for builds before 08:00 Beijing.
export function getTodayStr() {
  const bj = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  return `${bj.getFullYear()}${String(bj.getMonth() + 1).padStart(2, '0')}${String(bj.getDate()).padStart(2, '0')}`;
}

export function getTodayDisplay() {
  const bj = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  return `${bj.getFullYear()}-${String(bj.getMonth() + 1).padStart(2, '0')}-${String(bj.getDate()).padStart(2, '0')}`;
}

// Beijing-date key (YYYYMMDD) for an arbitrary timestamp — bounds a day's report
// to that day's news instead of a rolling 24h window, so yesterday-evening
// headlines don't bleed into today's report (e.g. 08-07 新闻混进 08-08 日报).
export function beijingDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const bj = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  return `${bj.getFullYear()}${String(bj.getMonth() + 1).padStart(2, '0')}${String(bj.getDate()).padStart(2, '0')}`;
}
