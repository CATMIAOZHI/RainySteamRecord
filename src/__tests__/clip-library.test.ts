import { describe, expect, it } from "vitest";
import { formatBytes, queryClips, selectRange, totalClipSize, type ClipQuery } from "../lib/clip-library";
import type { ClipInfo } from "../lib/tauri-bridge";

const clip = (overrides: Partial<ClipInfo>): ClipInfo => ({
  folder: "C:\\clips\\one",
  folder_name: "clip_10_20260101_120000",
  game_id: "10",
  game_name: "Counter-Strike",
  datetime: "2026-01-01 12:00:00",
  duration: "1:00",
  duration_seconds: 60,
  size_bytes: 1024,
  width: 1920,
  height: 1080,
  video_codec: "avc1",
  audio_codec: "mp4a",
  frame_rate: 60,
  session_count: 1,
  health_status: "healthy",
  issues: [],
  media_type: "manual",
  ...overrides,
});

const query: ClipQuery = { search: "", gameId: "", dateFrom: "", dateTo: "", sortField: "datetime", sortDirection: "desc" };

describe("clip library", () => {
  it("searches names, IDs, and folders case-insensitively", () => {
    const clips = [clip({}), clip({ folder: "C:\\clips\\two", folder_name: "special-folder", game_id: "765611", game_name: "Portal" })];
    expect(queryClips(clips, { ...query, search: "SPECIAL" })).toHaveLength(1);
    expect(queryClips(clips, { ...query, search: "765611" })[0].game_name).toBe("Portal");
  });

  it("filters dates and sorts numeric fields", () => {
    const clips = [clip({ size_bytes: 20 }), clip({ folder: "two", datetime: "2025-01-01 00:00:00", size_bytes: 10 })];
    expect(queryClips(clips, { ...query, dateFrom: "2026-01-01" })).toHaveLength(1);
    expect(queryClips(clips, { ...query, sortField: "size", sortDirection: "asc" }).map((item) => item.size_bytes)).toEqual([10, 20]);
  });

  it("formats totals and selects inclusive ranges", () => {
    expect(totalClipSize([clip({}), clip({ folder: "two", size_bytes: 1024 })])).toBe(2048);
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect([...selectRange(["a", "b", "c"], "a", "c", new Set())]).toEqual(["a", "b", "c"]);
  });
});
