import { create } from "zustand";
import type { AppConfig, ClipInfo, GameIds } from "../lib/tauri-bridge";
import { tauriBridge } from "../lib/tauri-bridge";

interface AppState {
  config: AppConfig | null;
  steamIds: string[];
  selectedSteamId: string;
  selectedMediaType: string;
  selectedGameId: string;
  clips: ClipInfo[];
  gameIds: GameIds;
  selectedClips: Set<string>;
  clipIndex: number;
  isConverting: boolean;
  progress: { current: number; total: number; percent: number; message: string } | null;
  loading: boolean;

  loadConfig: () => Promise<void>;
  loadSteamIds: () => Promise<void>;
  selectSteamId: (id: string) => void;
  selectMediaType: (type: string) => void;
  selectGameId: (id: string) => void;
  loadClips: () => Promise<void>;
  loadGameIds: () => Promise<void>;
  toggleClipSelection: (folder: string) => void;
  clearSelection: () => void;
  nextPage: () => void;
  prevPage: () => void;
  setConverting: (v: boolean) => void;
  setProgress: (p: { current: number; total: number; percent: number; message: string } | null) => void;
  saveConfig: (config: Partial<AppConfig>) => Promise<void>;
  convertClips: (folders: string[]) => Promise<void>;
  exportAll: () => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  config: null,
  steamIds: [],
  selectedSteamId: "",
  selectedMediaType: "all",
  selectedGameId: "",
  clips: [],
  gameIds: {},
  selectedClips: new Set(),
  clipIndex: 0,
  isConverting: false,
  progress: null,
  loading: false,

  loadConfig: async () => {
    try {
      const config = await tauriBridge.getConfig();
      set({ config });
    } catch (e) {
      console.error("Failed to load config:", e);
    }
  },

  loadSteamIds: async () => {
    const { config } = get();
    if (!config?.userdata_path) return;
    try {
      const ids = await tauriBridge.listSteamIds(config.userdata_path);
      set({ steamIds: ids, selectedSteamId: ids[0] || "" });
    } catch (e) {
      console.error("Failed to list steam IDs:", e);
    }
  },

  selectSteamId: (id) => {
    set({ selectedSteamId: id, clipIndex: 0, selectedGameId: "", selectedClips: new Set() });
  },

  selectMediaType: (type) => {
    set({ selectedMediaType: type, clipIndex: 0, selectedClips: new Set() });
  },

  selectGameId: (id) => {
    set({ selectedGameId: id, clipIndex: 0, selectedClips: new Set() });
  },

  loadClips: async () => {
    const { config, selectedSteamId, selectedMediaType, gameIds } = get();
    if (!config?.userdata_path || !selectedSteamId) return;
    set({ loading: true });
    try {
      const clips = await tauriBridge.listClips(config.userdata_path, selectedSteamId, selectedMediaType);
      set({ clips, loading: false, clipIndex: 0 });
      const unknownIds = [...new Set(clips.map((c) => c.game_id))].filter(
        (id) => !gameIds[id] || gameIds[id] === id
      );
      if (unknownIds.length > 0) {
        try {
          const updated = await tauriBridge.fetchGameNamesBatch(unknownIds);
          set({ gameIds: updated });
        } catch (e) {
          console.error("Failed to fetch game names:", e);
        }
      }
    } catch (e) {
      console.error("Failed to load clips:", e);
      set({ clips: [], loading: false });
    }
  },

  loadGameIds: async () => {
    try {
      const ids = await tauriBridge.getGameIds();
      set({ gameIds: ids });
    } catch (e) {
      console.error("Failed to load game IDs:", e);
    }
  },

  toggleClipSelection: (folder) => {
    const { selectedClips } = get();
    const newSet = new Set(selectedClips);
    if (newSet.has(folder)) {
      newSet.delete(folder);
    } else {
      newSet.add(folder);
    }
    set({ selectedClips: newSet });
  },

  clearSelection: () => set({ selectedClips: new Set() }),

  nextPage: () => {
    const { clipIndex, clips } = get();
    if (clipIndex + CLIPS_PER_PAGE < clips.length) {
      set({ clipIndex: clipIndex + CLIPS_PER_PAGE });
    }
  },

  prevPage: () => {
    const { clipIndex } = get();
    if (clipIndex - CLIPS_PER_PAGE >= 0) {
      set({ clipIndex: clipIndex - CLIPS_PER_PAGE });
    }
  },

  setConverting: (v) => set({ isConverting: v }),
  setProgress: (p) => set({ progress: p }),

  saveConfig: async (partial) => {
    const { config } = get();
    if (!config) return;
    const newConfig = { ...config, ...partial };
    set({ config: newConfig });
    await tauriBridge.saveConfig(
      newConfig.userdata_path || undefined,
      newConfig.export_path,
      newConfig.theme,
      newConfig.language,
    );
  },

  convertClips: async (folders) => {
    const { config, gameIds } = get();
    if (!config?.export_path || folders.length === 0) return;
    set({ isConverting: true, progress: { current: 0, total: folders.length, percent: 0, message: "Initializing..." } });
    try {
      await tauriBridge.convertClips(folders, config.export_path, gameIds);
    } catch (e) {
      console.error("Conversion failed:", e);
      set({ isConverting: false, progress: null });
    }
  },

  exportAll: async () => {
    const { clips, selectedGameId, convertClips } = get();
    const filtered = selectedGameId ? clips.filter((c) => c.game_id === selectedGameId) : clips;
    await convertClips(filtered.map((c) => c.folder));
  },
}));

export const CLIPS_PER_PAGE = 9;