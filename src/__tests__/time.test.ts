import { describe, expect, it } from "vitest";
import { formatTimestamp, parseTimestamp } from "../lib/time";

describe("timestamp input", () => {
  it("parses seconds, minute, and hour formats", () => {
    expect(parseTimestamp("90.5")).toBe(90.5);
    expect(parseTimestamp("01:30.50")).toBe(90.5);
    expect(parseTimestamp("01:02:03.25")).toBe(3723.25);
  });

  it("rejects malformed and out-of-range values", () => {
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("1:60")).toBeNull();
    expect(parseTimestamp("1:60:00")).toBeNull();
    expect(parseTimestamp("-1")).toBeNull();
    expect(parseTimestamp("one minute")).toBeNull();
  });

  it("formats values for editing", () => {
    expect(formatTimestamp(90.5)).toBe("01:30.50");
    expect(formatTimestamp(3723.25)).toBe("01:02:03.25");
  });
});
