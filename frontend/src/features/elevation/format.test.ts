import { describe, expect, it } from "vitest";
import { formatDistance, formatDuration, formatElevation, formatGrade } from "./format";

describe("result units and rounding", () => {
  it("formats distance consistently across the kilometre boundary", () => {
    expect(formatDistance(1200)).toBe("1.20 km");
    expect(formatDistance(999.6)).toBe("1.00 km");
    expect(formatDistance(300.2)).toBe("300 m");
    expect(formatDistance(NaN)).toBe("不明");
  });
  it("keeps real zero and negative elevation, and distinguishes missing values", () => {
    expect(formatElevation(0)).toBe("0.0 m");
    expect(formatElevation(-2.56)).toBe("-2.6 m");
    expect(formatElevation(null)).toBe("不明");
    expect(formatElevation(Infinity)).toBe("不明");
    expect(formatGrade(5.26)).toBe("+5.3 %");
    expect(formatGrade(-2)).toBe("−2.0 %");
    expect(formatGrade(-0.001)).toBe("0.0 %");
    expect(formatGrade(null)).toBe("不明");
  });
  it("rounds duration to minutes and rejects invalid values", () => {
    expect(formatDuration(3599)).toBe("1 時間 0 分");
    expect(formatDuration(30)).toBe("1 分");
    expect(formatDuration(NaN)).toBe("不明");
  });
});
