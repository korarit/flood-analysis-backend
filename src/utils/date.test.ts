import { describe, expect, it } from "bun:test";
import {
  formatBangkokDate,
  formatBangkokDateTime,
  getBangkokDateParts,
  getThaiDateString,
  getThaiTimeString,
  parseThaiWaterDate,
} from "./date";

describe("Bangkok Date Utilities", () => {
  it("formatBangkokDateTime correctly formats in UTC+7", () => {
    // 2026-09-08 21:00:00 UTC == 2026-09-09 04:00:00 Bangkok
    const d = new Date("2026-09-08T21:00:00.000Z");
    const formatted = formatBangkokDateTime(d);
    expect(formatted).toBe("2026-09-09 04:00");
  });

  it("formatBangkokDate correctly formats date in UTC+7", () => {
    // 2026-09-08 20:00:00 UTC == 2026-09-09 03:00:00 Bangkok
    const d = new Date("2026-09-08T20:00:00.000Z");
    expect(formatBangkokDate(d)).toBe("2026-09-09");
  });

  it("parseThaiWaterDate preserves +07:00 if present", () => {
    const d = parseThaiWaterDate("2026-09-09T03:00:00+07:00");
    expect(d.toISOString()).toBe("2026-09-08T20:00:00.000Z");
  });

  it("parseThaiWaterDate automatically adds +07:00 if offset is missing", () => {
    const d = parseThaiWaterDate("2026-09-09 03:00:00");
    expect(d.toISOString()).toBe("2026-09-08T20:00:00.000Z");
  });

  it("getThaiDateString formats Buddhist year and Thai month correctly", () => {
    const d = new Date("2026-09-08T21:00:00.000Z"); // Sept 9 Bangkok
    expect(getThaiDateString(d)).toBe("9 กันยายน 2569");
  });

  it("getThaiTimeString formats Thai time correctly", () => {
    const d = new Date("2026-09-08T21:15:00.000Z"); // 04:15 Bangkok
    expect(getThaiTimeString(d)).toBe("04:15 น.");
  });

  it("getBangkokDateParts extracts correct UTC+7 parts", () => {
    const d = new Date("2026-09-08T21:45:30.000Z");
    const parts = getBangkokDateParts(d);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(9);
    expect(parts.day).toBe(9);
    expect(parts.hours).toBe(4);
    expect(parts.minutes).toBe(45);
    expect(parts.seconds).toBe(30);
  });
});
