/**
 * Date and Timezone Utilities for Thailand (UTC+7 / Asia/Bangkok)
 * Ensures consistent datetime formatting and parsing regardless of local server
 * or GitHub Actions runner timezone (which defaults to UTC).
 */

const PAD = (n: number) => String(n).padStart(2, "0");

/**
 * Returns Bangkok datetime components (year, month, day, hours, minutes, seconds)
 * Thailand is permanently UTC+7 with no Daylight Saving Time.
 */
export function getBangkokDateParts(d: Date = new Date()) {
  const bkk = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return {
    year: bkk.getUTCFullYear(),
    month: bkk.getUTCMonth() + 1,
    day: bkk.getUTCDate(),
    hours: bkk.getUTCHours(),
    minutes: bkk.getUTCMinutes(),
    seconds: bkk.getUTCSeconds(),
  };
}

/**
 * Formats a Date object into "YYYY-MM-DD HH:00" in Asia/Bangkok time.
 * Required for ThaiWater API endpoints (e.g. /rainfall_c60/graph?timezone=7).
 */
export function formatBangkokDateTime(d: Date = new Date()): string {
  const { year, month, day, hours } = getBangkokDateParts(d);
  return `${year}-${PAD(month)}-${PAD(day)} ${PAD(hours)}:00`;
}

/**
 * Formats a Date or timestamp into "YYYY-MM-DD" in Asia/Bangkok time.
 */
export function formatBangkokDate(d: Date | number = new Date()): string {
  const dateObj = typeof d === "number" ? new Date(d) : d;
  const { year, month, day } = getBangkokDateParts(dateObj);
  return `${year}-${PAD(month)}-${PAD(day)}`;
}

/**
 * Safely parses any date string from ThaiWater API into a proper Date object.
 * If the string lacks an explicit timezone offset (+07:00 or Z), +07:00 is appended
 * so that UTC environments (such as GitHub Actions) do not misinterpret it as UTC.
 */
export function parseThaiWaterDate(dateStr?: string | null): Date {
  if (!dateStr) return new Date();
  let s = String(dateStr).trim();
  // Check if offset (+HH:MM, -HH:MM, or Z) is already present
  if (!s.includes("+") && !s.includes("Z") && !s.match(/-\d{2}:\d{2}$/)) {
    s = s.replace(" ", "T");
    if (s.length === 16) s += ":00"; // e.g. YYYY-MM-DDTHH:mm -> YYYY-MM-DDTHH:mm:00
    s += "+07:00";
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Formats Thai Buddhist calendar date string (e.g. "9 กันยายน 2569")
 */
export function getThaiDateString(d: Date = new Date()): string {
  const thaiMonths = [
    "มกราคม",
    "กุมภาพันธ์",
    "มีนาคม",
    "เมษายน",
    "พฤษภาคม",
    "มิถุนายน",
    "กรกฎาคม",
    "สิงหาคม",
    "กันยายน",
    "ตุลาคม",
    "พฤศจิกายน",
    "ธันวาคม",
  ];
  const { year, month, day } = getBangkokDateParts(d);
  return `${day} ${thaiMonths[month - 1]} ${year + 543}`;
}

/**
 * Formats Thai time string (e.g. "04:30 น.")
 */
export function getThaiTimeString(d: Date = new Date()): string {
  const { hours, minutes } = getBangkokDateParts(d);
  return `${PAD(hours)}:${PAD(minutes)} น.`;
}
