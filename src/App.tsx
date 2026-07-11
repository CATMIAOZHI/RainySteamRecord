import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "./stores/app";
import { applyTheme } from "./lib/theme";
import TitleBar from "./components/TitleBar";
import FilterBar from "./components/FilterBar";
import ClipGrid from "./components/ClipGrid";
import BottomBar from "./components/BottomBar";
import SettingsDialog from "./components/SettingsDialog";
import SteamVersionPicker from "./components/SteamVersionPicker";
import ToastViewport from "./components/ToastViewport";
import ExportJobCenter from "./components/ExportJobCenter";
import ConfirmDialog from "./components/ConfirmDialog";
import { listenForExportJobs, useExportJobs } from "./stores/export-jobs";
import { overlayRegistry } from "./lib/overlay";

export default function App() {
  const { i18n } = useTranslation();
  const config = useStore((state) => state.config);
  const loadConfig = useStore((state) => state.loadConfig);
  const loadSteamIds = useStore((state) => state.loadSteamIds);
  const loadClips = useStore((state) => state.loadClips);
  const loadGameIds = useStore((state) => state.loadGameIds);
  const selectedSteamId = useStore((state) => state.selectedSteamId);
  const selectedMediaType = useStore((state) => state.selectedMediaType);
  const saveConfig = useStore((state) => state.saveConfig);

  const [showSettings, setShowSettings] = useState(false);
  const [showVersionPicker, setShowVersionPicker] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    (async () => {
      await loadConfig();
      await loadGameIds();
      setInitialized(true);
    })();

    const unlisten = listenForExportJobs();
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!initialized || !config) return;
    applyTheme(config.theme);
    i18n.changeLanguage(config.language);
  }, [initialized, config?.theme, config?.language, i18n]);

  useEffect(() => {
    if (!initialized || !config) return;
    if (!config.userdata_path) {
      setShowVersionPicker(true);
    } else {
      loadSteamIds();
    }
  }, [initialized, config?.userdata_path, loadSteamIds]);

  useEffect(() => {
    if (selectedSteamId) loadClips();
  }, [selectedSteamId, selectedMediaType, loadClips]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && overlayRegistry.closeTopOverlay()) {
        event.preventDefault();
        return;
      }
      if (overlayRegistry.hasOpenOverlay()) return;
      const target = event.target as HTMLElement;
      const editing = target.matches("input, textarea, select, [contenteditable=true]");
      const state = useStore.getState();
      if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("#library-search")?.focus();
      } else if (event.ctrlKey && event.key.toLowerCase() === "a" && !editing) {
        event.preventDefault();
        state.toggleFilteredSelection();
      } else if (event.ctrlKey && event.key.toLowerCase() === "e" && !editing) {
        event.preventDefault();
        const exportState = useExportJobs.getState();
        if (state.config) void exportState.start([...state.selectedClips], state.config.export_path, state.gameIds);
      } else if (event.ctrlKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void state.loadClips();
      } else if (event.key === "Delete" && !editing && state.selectedClips.size > 0) {
        event.preventDefault();
        setConfirmDelete(true);
      } else if (event.key === "Escape" && !editing) {
        state.clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [i18n]);

  const handleVersionSelect = async (path: string) => {
    setShowVersionPicker(false);
    await saveConfig({ userdata_path: path });
  };

  if (!initialized || !config) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar />

      <div className="flex items-center justify-between px-5 pt-2">
        <FilterBar />
        <button
          onClick={() => setShowSettings(true)}
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      <ClipGrid />
      <BottomBar />

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showVersionPicker && <SteamVersionPicker onSelect={handleVersionSelect} />}
      <ToastViewport />
      <ExportJobCenter />
      {confirmDelete && <ConfirmDialog title={i18n.t("library.deleteSelected")} message={i18n.t("library.deleteSelectedConfirm", { count: useStore.getState().selectedClips.size })} danger onClose={() => setConfirmDelete(false)} onConfirm={() => void useStore.getState().trashSelected()} />}
    </div>
  );
}
