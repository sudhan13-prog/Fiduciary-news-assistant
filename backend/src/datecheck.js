// Automatic weekday/date check. Language models often pair a date with the wrong weekday
// (e.g. "Friday, January 3 2027" - that date is a Sunday). Code can check this reliably.
// Only dates with a year are checked, so there is no guessing.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const S = '[\\s\\u00a0\\u202f]+'; // spaces, including the non-breaking spaces models often output
const WD = '(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thur|thu|fri|sat|sun)\\.?';
const MON = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const YEAR = '(\\d{4})';

const PATTERNS = [
  // Friday, December 4, 2026  /  Fri Dec 4 2026
  { re: new RegExp(`\\b${WD},?${S}${MON}${S}${DAY},?${S}${YEAR}\\b`, 'gi'), order: ['wd', 'mon', 'day', 'year'] },
  // Friday, 4 December 2026  /  Friday 4th of December, 2026
  { re: new RegExp(`\\b${WD},?${S}${DAY}${S}(?:of${S})?${MON},?${S}${YEAR}\\b`, 'gi'), order: ['wd', 'day', 'mon', 'year'] },
  // Friday, 2026-12-04
  { re: new RegExp(`\\b${WD},?${S}(\\d{4})-(\\d{2})-(\\d{2})\\b`, 'gi'), order: ['wd', 'year', 'monNum', 'day'] },
];

function weekdayIndex(word) {
  const w = word.toLowerCase().replace('.', '');
  return WEEKDAYS.findIndex((d) => d.startsWith(w.slice(0, 3)));
}

function monthIndex(word) {
  const m = word.toLowerCase().replace('.', '');
  return MONTHS.findIndex((name) => name.startsWith(m.slice(0, 3)));
}

/**
 * Returns every weekday + date pair in the text whose weekday is wrong:
 * [{ text: "Friday, January 3 2027", stated: "Friday", actual: "Sunday", date: "2027-01-03" }]
 */
export function findWeekdayMismatches(text) {
  const found = [];
  const seen = new Set();
  for (const { re, order } of PATTERNS) {
    for (const m of String(text ?? '').matchAll(re)) {
      const parts = {};
      order.forEach((key, i) => (parts[key] = m[i + 1]));
      const year = Number(parts.year);
      const month = parts.monNum ? Number(parts.monNum) - 1 : monthIndex(parts.mon);
      const day = Number(parts.day);
      if (month < 0 || month > 11 || day < 1 || year < 1900 || year > 2100) continue;
      const date = new Date(Date.UTC(year, month, day));
      if (date.getUTCMonth() !== month) continue; // e.g. 31 February - not a real date
      const stated = weekdayIndex(parts.wd);
      const actual = date.getUTCDay();
      if (stated < 0 || stated === actual || seen.has(m[0])) continue;
      seen.add(m[0]);
      found.push({
        text: m[0],
        stated: cap(WEEKDAYS[stated]),
        actual: cap(WEEKDAYS[actual]),
        date: date.toISOString().slice(0, 10),
      });
    }
  }
  return found;
}

/** Last-resort fix: removes the wrong weekday, keeping the date ("Friday, January 3 2027" -> "January 3 2027"). */
export function removeWrongWeekdays(text, mismatches) {
  let out = String(text ?? '');
  for (const m of mismatches) {
    const withoutWeekday = m.text.replace(new RegExp(`^${WD},?${S}`, 'i'), '');
    out = out.split(m.text).join(withoutWeekday);
  }
  return out;
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);
