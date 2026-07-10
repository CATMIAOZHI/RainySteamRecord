import { create } from "zustand";
import type { AppConfig, ClipInfo, GameIds } from "../lib/tauri-bridge";
import { tauriBridge } from "../lib/tauri-bridge";

let clipLoadGeneration = 0;

interface AppState {
  config: AppConfig | null;
  steamIds: string[];
  selectedSteamId: string;
  selectedMediaType: string;
  selectedGameId: string;
  selectedDateFrom: string;
  selectedDateTo: string;
  clips: ClipInfo[];
  gameIds: GameIds;
  selectedClips: Set<string>;
  isConverting: boolean;
  progress: { current: number; total: number; percent: number; message: string } | null;
  loading: boolean;

  loadConfig: () => Promise<void>;
  loadSteamIds: () => Promise<void>;
  selectSteamId: (id: string) => void;
  selectMediaType: (type: string) => void;
  selectGameId: (id: string) => void;
  selectDateFrom: (date: string) => void;
  selectDateTo: (date: string) => void;
  loadClips: () => Promise<void>;
  loadGameIds: () => Promise<void>;
  toggleClipSelection: (folder: string) => void;
  clearSelection: () => void;
  setConverting: (v: boolean) => void;
  setProgress: (p: { current: number; total: number; percent: number; message: string } | null) => void;
  saveConfig: (config: Partial<AppConfig>) => Promise<void>;
  convertClips: (folders: string[]) => Promise<void>;
  toggleFilteredSelection: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  config: null,
  steamIds: [],
  selectedSteamId: "",
  selectedMediaType: "all",
  selectedGameId: "",
  selectedDateFrom: "",
  selectedDateTo: "",
  clips: [],
  gameIds: {},
  selectedClips: new Set(),
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
    set({ selectedSteamId: id, selectedGameId: "", selectedClips: new Set() });
  },

  selectMediaType: (type) => {
    set({ selectedMediaType: type, selectedClips: new Set() });
  },

  selectGameId: (id) => {
    set({ selectedGameId: id, selectedClips: new Set() });
  },

  selectDateFrom: (date) => {
    set({ selectedDateFrom: date, selectedClips: new Set() });
  },

  selectDateTo: (date) => {
    set({ selectedDateTo: date, selectedClips: new Set() });
  },

  loadClips: async () => {
    const { config, selectedSteamId, selectedMediaType } = get();
    if (!config?.userdata_path || !selectedSteamId) return;
    const generation = ++clipLoadGeneration;
    set({ loading: true });
    try {
      const clips = await tauriBridge.listClips(config.userdata_path, selectedSteamId, selectedMediaType, false);
      if (generation !== clipLoadGeneration) return;
      set({ clips, loading: false });
      const gameIds = get().gameIds;
      const unknownIds = [...new Set(clips.map((c) => c.game_id))].filter(
        (id) => !gameIds[id] || gameIds[id] === id,
      );
      if (unknownIds.length > 0) {
        try {
          const updated = await tauriBridge.fetchGameNamesBatch(unknownIds);
          if (generation === clipLoadGeneration) {
            set((state) => ({ gameIds: { ...state.gameIds, ...updated } }));
          }
        } catch (e) {
          console.error("Failed to fetch game names:", e);
        }
      }
    } catch (e) {
      console.error("Failed to load clips:", e);
      if (generation === clipLoadGeneration) set({ clips: [], loading: false });
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

  setConverting: (v) => set({ isConverting: v }),
  setProgress: (p) => set({ progress: p }),

  saveConfig: async (partial) => {
    const { config } = get();
    if (!config) return;
    const newConfig = { ...config, ...partial };
    await tauriBridge.saveConfig(
      newConfig.userdata_path || undefined,
      newConfig.export_path,
      newConfig.theme,
      newConfig.language,
    );
    set({ config: newConfig });
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

  toggleFilteredSelection: () => {
    const { clips, selectedGameId, selectedDateFrom, selectedDateTo, selectedClips } = get();
    const filtered = filterClips(clips, selectedGameId, selectedDateFrom, selectedDateTo);
    const allSelected = filtered.length > 0 && filtered.every((clip) => selectedClips.has(clip.folder));
    const next = new Set(selectedClips);
    for (const clip of filtered) {
      if (allSelected) next.delete(clip.folder);
      else next.add(clip.folder);
    }
    set({ selectedClips: next });
  },
}));

export function filterClips(clips: ClipInfo[], gameId: string, dateFrom: string, dateTo: string) {
  return clips.filter((clip) => {
    if (gameId && clip.game_id !== gameId) return false;
    const date = clip.datetime?.slice(0, 10);
    if (dateFrom && (!date || date < dateFrom)) return false;
    if (dateTo && (!date || date > dateTo)) return false;
    return true;
  });
}
