import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClipInfo } from "../lib/tauri-bridge";

const bridge = vi.hoisted(() => ({
  listClipsQuick: vi.fn(),
  listClips: vi.fn(),
  fetchGameNamesBatch: vi.fn(),
}));

const showToast = vi.hoisted(() => vi.fn());

vi.mock("../lib/tauri-bridge", () => ({ tauriBridge: bridge }));
vi.mock("../stores/toast", () => ({ toast: showToast }));

import { useStore } from "../stores/app";

const clip = (folder: string, health_status: ClipInfo["health_status"]): ClipInfo => ({
  folder,
  folder_name: `clip_10_20260101_12000${folder}`,
  game_id: "10",
  game_name: "Game",
  datetime: "2026-01-01 12:00:00",
  duration: "1:00",
  duration_seconds: 60,
  size_bytes: health_status === "checking" ? 0 : 1024,
  width: 1920,
  height: 1080,
  video_codec: "avc1",
  audio_codec: "mp4a",
  frame_rate: 60,
  session_count: 1,
  health_status,
  issues: [],
  media_type: "manual",
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("clip loading", () => {
  beforeEach(() => {
    bridge.listClipsQuick.mockReset();
    bridge.listClips.mockReset();
    bridge.fetchGameNamesBatch.mockReset();
    bridge.fetchGameNamesBatch.mockResolvedValue({ "10": "Game" });
    showToast.mockReset();
    useStore.setState({
      config: { userdata_path: "C:\\userdata", export_path: "", theme: "rainy", language: "en-US" },
      selectedSteamId: "1",
      selectedMediaType: "all",
      clips: [],
      selectedClips: new Set(),
      loading: false,
      scanning: false,
    });
  });

  it("shows quick clips before replacing them with the full scan", async () => {
    const full = deferred<ClipInfo[]>();
    bridge.listClipsQuick.mockResolvedValue([clip("quick", "checking")]);
    bridge.listClips.mockReturnValue(full.promise);
    const loading = useStore.getState().loadClips();
    await vi.waitFor(() => expect(useStore.getState().clips[0]?.folder).toBe("quick"));
    expect(useStore.getState()).toMatchObject({ loading: false, scanning: true });
    full.resolve([clip("full", "healthy")]);
    await loading;
    expect(useStore.getState().clips[0].folder).toBe("full");
    expect(useStore.getState().scanning).toBe(false);
  });

  it("ignores stale scans and preserves quick clips when full scanning fails", async () => {
    const staleQuick = deferred<ClipInfo[]>();
    bridge.listClipsQuick
      .mockReturnValueOnce(staleQuick.promise)
      .mockResolvedValueOnce([clip("current", "checking")]);
    bridge.listClips.mockRejectedValue(new Error("scan failed"));
    const stale = useStore.getState().loadClips();
    useStore.setState({ selectedSteamId: "2" });
    await useStore.getState().loadClips();
    staleQuick.resolve([clip("stale", "checking")]);
    await stale;
    expect(useStore.getState().clips[0].folder).toBe("current");
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("scan failed"), "error");
  });

  it("removes selections that are absent from accepted scan results", async () => {
    useStore.setState({ selectedClips: new Set(["kept", "removed"]) });
    bridge.listClipsQuick.mockResolvedValue([clip("kept", "checking")]);
    bridge.listClips.mockResolvedValue([clip("kept", "healthy")]);

    await useStore.getState().loadClips();

    expect([...useStore.getState().selectedClips]).toEqual(["kept"]);
  });
});
