import { create } from "zustand";
import type { AppConfig, ClipInfo, GameIds } from "../lib/tauri-bridge";
import { tauriBridge } from "../lib/tauri-bridge";
import { defaultClipQuery, queryClips, selectRange, type ClipQuery, type SortDirection, type SortField } from "../lib/clip-library";
import { toast } from "./toast";
import i18n from "../lib/i18n";
import { invalidateThumbnail } from "../lib/thumbnail-cache";

let clipLoadGeneration = 0;
let initializationGeneration = 0;
const queryStorageKey = "rainy-clip-query-v1";

function loadQuery(): ClipQuery {
  if (typeof localStorage === "undefined") return defaultClipQuery;
  try {
    return { ...defaultClipQuery, ...JSON.parse(localStorage.getItem(queryStorageKey) || "{}") };
  } catch {
    return defaultClipQuery;
  }
}

const savedQuery = loadQuery();

export type InitializationStatus =
  | "loading-config"
  | "config-error"
  | "needs-userdata"
  | "saving-userdata"
  | "loading-accounts"
  | "accounts-error"
  | "no-accounts"
  | "ready";

interface AppState {
  config: AppConfig | null;
  steamIds: string[];
  selectedSteamId: string;
  selectedMediaType: string;
  selectedGameId: string;
  selectedDateFrom: string;
  selectedDateTo: string;
  search: string;
  sortField: SortField;
  sortDirection: SortDirection;
  clips: ClipInfo[];
  gameIds: GameIds;
  selectedClips: Set<string>;
  loading: boolean;
  scanning: boolean;
  selectionAnchor: string | null;
  detailedScanError: string | null;

  initializationStatus: InitializationStatus;
  initializationError: string | null;
  initialize: () => Promise<void>;
  retryInitialization: () => Promise<void>;
  chooseAnotherUserdata: () => void;
  saveUserdataPath: (path: string) => Promise<void>;
  clearFilters: () => void;
  reloadClips: (options?: { force?: boolean }) => Promise<void>;

  loadConfig: () => Promise<void>;
  loadSteamIds: () => Promise<void>;
  selectSteamId: (id: string) => void;
  selectMediaType: (type: string) => void;
  selectGameId: (id: string) => void;
  selectDateFrom: (date: string) => void;
  selectDateTo: (date: string) => void;
  setSearch: (search: string) => void;
  setSort: (field: SortField, direction?: SortDirection) => void;
  loadClips: (options?: { force?: boolean }) => Promise<void>;
  loadGameIds: () => Promise<void>;
  toggleClipSelection: (folder: string) => void;
  selectClipRange: (folder: string, orderedFolders: string[]) => void;
  clearSelection: () => void;
  saveConfig: (config: Partial<AppConfig>) => Promise<void>;
  toggleFilteredSelection: () => void;
  trashSelected: () => Promise<void>;
  regenerateSelectedThumbnails: () => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  config: null,
  steamIds: [],
  selectedSteamId: "",
  selectedMediaType: "all",
  selectedGameId: savedQuery.gameId,
  selectedDateFrom: savedQuery.dateFrom,
  selectedDateTo: savedQuery.dateTo,
  search: savedQuery.search,
  sortField: savedQuery.sortField,
  sortDirection: savedQuery.sortDirection,
  clips: [],
  gameIds: {},
  selectedClips: new Set(),
  loading: false,
  scanning: false,
  selectionAnchor: null,
  detailedScanError: null,

  initializationStatus: "loading-config",
  initializationError: null,

  initialize: async () => {
    const generation = ++initializationGeneration;
    set({ initializationStatus: "loading-config", initializationError: null });
    try {
      const config = await tauriBridge.getConfig();
      if (generation !== initializationGeneration) return;
      set({ config });
      try {
        const gameIds = await tauriBridge.getGameIds();
        if (generation !== initializationGeneration) return;
        set({ gameIds });
      } catch (e) {
        toast(String(e), "error");
      }
      if (!config.userdata_path) {
        set({ initializationStatus: "needs-userdata" });
      } else {
        set({ initializationStatus: "loading-accounts" });
        try {
          const ids = await tauriBridge.listSteamIds(config.userdata_path);
          if (generation !== initializationGeneration) return;
          set({ steamIds: ids, selectedSteamId: ids[0] || "" });
          if (ids.length === 0) {
            set({ initializationStatus: "no-accounts" });
          } else {
            set({ initializationStatus: "ready" });
          }
        } catch (e) {
          if (generation !== initializationGeneration) return;
          set({ initializationStatus: "accounts-error", initializationError: String(e) });
        }
      }
    } catch (e) {
      if (generation !== initializationGeneration) return;
      set({ initializationStatus: "config-error", initializationError: String(e) });
    }
  },

  retryInitialization: async () => {
    const { initializationStatus, config } = get();
    if (initializationStatus === "config-error") {
      await get().initialize();
    } else if (initializationStatus === "accounts-error" || initializationStatus === "no-accounts") {
      if (!config?.userdata_path) {
        set({ initializationStatus: "needs-userdata" });
        return;
      }
      const generation = ++initializationGeneration;
      set({ initializationStatus: "loading-accounts", initializationError: null });
      try {
        const ids = await tauriBridge.listSteamIds(config.userdata_path);
        if (generation !== initializationGeneration) return;
        set({ steamIds: ids, selectedSteamId: ids[0] || "" });
        if (ids.length === 0) {
          set({ initializationStatus: "no-accounts" });
        } else {
          set({ initializationStatus: "ready" });
        }
      } catch (e) {
        if (generation !== initializationGeneration) return;
        set({ initializationStatus: "accounts-error", initializationError: String(e) });
      }
    }
  },

  chooseAnotherUserdata: () => {
    initializationGeneration += 1;
    set({ initializationStatus: "needs-userdata", initializationError: null });
  },

  saveUserdataPath: async (path: string) => {
    const { initializationStatus } = get();
    if (initializationStatus === "saving-userdata") return;
    const generation = ++initializationGeneration;
    set({ initializationStatus: "saving-userdata", initializationError: null });
    try {
      const config = get().config;
      const exportPath = config?.export_path || "";
      const theme = config?.theme || "rainy";
      const language = config?.language || "zh-CN";
      await tauriBridge.saveConfig(
        path,
        exportPath || undefined,
        theme,
        language
      );
      if (generation !== initializationGeneration) return;
      const newConfig = {
        userdata_path: path,
        export_path: exportPath,
        theme,
        language
      };
      set({ config: newConfig });
      set({ initializationStatus: "loading-accounts" });
      const ids = await tauriBridge.listSteamIds(path);
      if (generation !== initializationGeneration) return;
      set({ steamIds: ids, selectedSteamId: ids[0] || "" });
      if (ids.length === 0) {
        set({ initializationStatus: "no-accounts" });
      } else {
        set({ initializationStatus: "ready" });
      }
    } catch (e) {
      if (generation !== initializationGeneration) return;
      set({ initializationStatus: "needs-userdata", initializationError: String(e) });
      toast(String(e), "error");
    }
  },

  loadConfig: async () => {
    try {
      const config = await tauriBridge.getConfig();
      set({ config });
    } catch (e) {
      toast(String(e), "error");
    }
  },

  loadSteamIds: async () => {
    const { config } = get();
    if (!config?.userdata_path) return;
    try {
      const ids = await tauriBridge.listSteamIds(config.userdata_path);
      set({ steamIds: ids, selectedSteamId: ids[0] || "" });
    } catch (e) {
      toast(String(e), "error");
    }
  },

  selectSteamId: (id) => {
    set({ selectedSteamId: id, selectedGameId: "", selectedClips: new Set() });
  },

  selectMediaType: (type) => {
    set({ selectedMediaType: type, selectedClips: new Set(), selectionAnchor: null });
  },

  selectGameId: (id) => {
    set({ selectedGameId: id });
  },

  selectDateFrom: (date) => {
    set({ selectedDateFrom: date });
  },

  selectDateTo: (date) => {
    set({ selectedDateTo: date });
  },

  setSearch: (search) => set({ search }),
  setSort: (sortField, direction) => set((state) => ({
    sortField,
    sortDirection: direction || (state.sortField === sortField && state.sortDirection === "desc" ? "asc" : "desc"),
    selectionAnchor: null,
  })),

  clearFilters: () => {
    set({
      search: "",
      selectedGameId: "",
      selectedDateFrom: "",
      selectedDateTo: "",
      selectedMediaType: "all",
    });
  },

  reloadClips: async (options) => {
    await get().loadClips(options);
  },

  loadClips: async (options) => {
    const { config, selectedSteamId, selectedMediaType } = get();
    if (!config?.userdata_path || !selectedSteamId) return;
    const force = options?.force ?? false;
    const generation = ++clipLoadGeneration;
    set({ loading: true, scanning: false, detailedScanError: null });
    try {
      if (!force) {
        const clips = await tauriBridge.listClipsQuick(config.userdata_path, selectedSteamId, selectedMediaType);
        if (generation === clipLoadGeneration) {
          const folders = new Set(clips.map((clip) => clip.folder));
          set((state) => ({
            clips,
            loading: false,
            scanning: true,
            selectedClips: new Set([...state.selectedClips].filter((folder) => folders.has(folder))),
          }));
        }
      }
    } catch (e) {
      if (generation === clipLoadGeneration) {
        toast(i18n.t("messages.quickScanFailed", { error: String(e) }), "error");
        set({ loading: false, scanning: true });
      }
    }
    if (generation !== clipLoadGeneration) return;
    try {
      const clips = await tauriBridge.listClips(config.userdata_path, selectedSteamId, selectedMediaType, !force);
      if (generation !== clipLoadGeneration) return;
      const folders = new Set(clips.map((clip) => clip.folder));
      set((state) => ({
        clips,
        scanning: false,
        detailedScanError: null,
        loading: false,
        selectedClips: new Set([...state.selectedClips].filter((folder) => folders.has(folder))),
      }));
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
          toast(String(e), "error");
        }
      }
    } catch (e) {
      if (generation !== clipLoadGeneration) return;
      toast(i18n.t("messages.fullScanFailed", { error: String(e) }), "error");
      set({ loading: false, scanning: false, detailedScanError: String(e) });
    }
  },

  loadGameIds: async () => {
    try {
      const ids = await tauriBridge.getGameIds();
      set({ gameIds: ids });
    } catch (e) {
      toast(String(e), "error");
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
    set({ selectedClips: newSet, selectionAnchor: folder });
  },

  selectClipRange: (folder, orderedFolders) => set((state) => ({
    selectedClips: selectRange(orderedFolders, state.selectionAnchor, folder, state.selectedClips),
  })),

  clearSelection: () => set({ selectedClips: new Set(), selectionAnchor: null }),

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

  toggleFilteredSelection: () => {
    const state = get();
    const { selectedClips } = state;
    const filtered = getVisibleClips(state);
    const allSelected = filtered.length > 0 && filtered.every((clip) => selectedClips.has(clip.folder));
    const next = new Set(selectedClips);
    for (const clip of filtered) {
      if (allSelected) next.delete(clip.folder);
      else next.add(clip.folder);
    }
    set({ selectedClips: next });
  },

  trashSelected: async () => {
    const folders = [...get().selectedClips];
    if (!folders.length) return;
    try {
      const result = await tauriBridge.trashClips(folders);
      const succeededSet = new Set(result.succeeded.map((item) => item.clip_folder));
      if (succeededSet.size > 0) {
        set((state) => ({
          selectedClips: new Set([...state.selectedClips].filter((f) => !succeededSet.has(f))),
          selectionAnchor: state.selectionAnchor && succeededSet.has(state.selectionAnchor) ? null : state.selectionAnchor,
        }));
        await get().loadClips();
      }
      if (result.failed.length) toast(i18n.t("messages.clipsDeletedPartial", { succeeded: result.succeeded.length, failed: result.failed.length }), "error");
      else toast(i18n.t("messages.clipsDeleted", { count: result.succeeded.length }), "success");
    } catch (error) {
      toast(String(error), "error");
    }
  },

  regenerateSelectedThumbnails: async () => {
    const folders = [...get().selectedClips];
    if (!folders.length) return;
    try {
      const result = await tauriBridge.regenerateThumbnails(folders);
      result.succeeded.forEach((item) => invalidateThumbnail(item.clip_folder));
      if (result.failed.length) toast(i18n.t("messages.thumbnailsRegeneratedPartial", { succeeded: result.succeeded.length, failed: result.failed.length }), "error");
      else toast(i18n.t("messages.thumbnailsRegenerated", { count: result.succeeded.length }), "success");
    } catch (error) {
      toast(String(error), "error");
    }
  },
}));

let persistedQuery = JSON.stringify(savedQuery);
useStore.subscribe((state) => {
  if (typeof localStorage === "undefined") return;
  const query = JSON.stringify({
    search: state.search,
    gameId: state.selectedGameId,
    dateFrom: state.selectedDateFrom,
    dateTo: state.selectedDateTo,
    sortField: state.sortField,
    sortDirection: state.sortDirection,
  } satisfies ClipQuery);
  if (query === persistedQuery) return;
  persistedQuery = query;
  localStorage.setItem(queryStorageKey, query);
});

export function getVisibleClips(state: Pick<AppState, "clips" | "gameIds" | "search" | "selectedGameId" | "selectedDateFrom" | "selectedDateTo" | "sortField" | "sortDirection">) {
  return queryClips(state.clips, {
    search: state.search,
    gameId: state.selectedGameId,
    dateFrom: state.selectedDateFrom,
    dateTo: state.selectedDateTo,
    sortField: state.sortField,
    sortDirection: state.sortDirection,
  }, state.gameIds);
}
