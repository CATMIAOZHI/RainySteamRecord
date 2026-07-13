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
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function App() {
  const { t, i18n } = useTranslation();
  const config = useStore((state) => state.config);
  const initializationStatus = useStore((state) => state.initializationStatus);
  const initializationError = useStore((state) => state.initializationError);
  const initialize = useStore((state) => state.initialize);
  const retryInitialization = useStore((state) => state.retryInitialization);
  const chooseAnotherUserdata = useStore((state) => state.chooseAnotherUserdata);
  const selectedSteamId = useStore((state) => state.selectedSteamId);
  const selectedMediaType = useStore((state) => state.selectedMediaType);
  const loadClips = useStore((state) => state.loadClips);

  const [showSettings, setShowSettings] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [closeAfterCancel, setCloseAfterCancel] = useState(false);
  const jobs = useExportJobs((state) => state.jobs);
  const activeJobs = jobs.filter((job) => ["queued", "running", "cancelling"].includes(job.status));

  const requestClose = () => {
    if (useExportJobs.getState().jobs.some((job) => ["queued", "running", "cancelling"].includes(job.status))) {
      setConfirmExit(true);
      return;
    }
    void getCurrentWindow().destroy();
  };

  useEffect(() => {
    void initialize();

    const unlisten = listenForExportJobs();
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      if (useExportJobs.getState().jobs.some((job) => ["queued", "running", "cancelling"].includes(job.status))) {
        event.preventDefault();
        setConfirmExit(true);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (closeAfterCancel && activeJobs.length === 0) {
      void getCurrentWindow().destroy();
    }
  }, [closeAfterCancel, activeJobs.length]);

  useEffect(() => {
    if (!config) return;
    applyTheme(config.theme);
    i18n.changeLanguage(config.language);
  }, [config?.theme, config?.language, i18n]);

  useEffect(() => {
    if (initializationStatus === "ready" && selectedSteamId) {
      void loadClips();
    }
  }, [initializationStatus, selectedSteamId, selectedMediaType, loadClips]);

  useEffect(() => {
    let lastFocusScanTime = 0;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusScanTime < 5000) return;
      const state = useStore.getState();
      if (state.initializationStatus === "ready" && !state.loading && !state.scanning) {
        lastFocusScanTime = now;
        void state.loadClips({ force: false });
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (overlayRegistry.closeTopOverlay()) {
          event.preventDefault();
          return;
        }
        const active = document.activeElement;
        if (active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) {
          active.blur();
          event.preventDefault();
          return;
        }
      }
      if (useStore.getState().initializationStatus !== "ready") return;
      if (overlayRegistry.hasOpenOverlay()) return;
      const target = event.target as HTMLElement;
      const editing = target.matches("input, textarea, select, [contenteditable=true]");
      const state = useStore.getState();
      if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        const input = document.querySelector<HTMLInputElement>("#library-search");
        if (input) {
          input.focus();
          input.select();
        }
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

  const renderContent = () => {
    switch (initializationStatus) {
      case "loading-config":
        return (
          <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <p className="text-sm text-text-muted">{t("initialization.loadingConfig")}</p>
          </div>
        );
      case "config-error":
        return (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 rounded-full bg-danger/10 p-3 text-danger">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-bold text-text">{t("initialization.configError", { error: "" })}</h3>
            <p className="mb-6 max-w-md text-sm text-text-muted">{initializationError}</p>
            <div className="flex gap-3">
              <button
                onClick={retryInitialization}
                className="h-10 rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                {t("initialization.retry")}
              </button>
              <button
                onClick={async () => {
                  const { invoke } = await import("@tauri-apps/api/core");
                  const configDir = await invoke<string>("get_config_dir");
                  await invoke("open_folder", { path: configDir });
                }}
                className="h-10 rounded-lg border border-border bg-surface px-5 text-sm text-text hover:bg-surface-hover"
              >
                {t("initialization.openConfigDir")}
              </button>
            </div>
          </div>
        );
      case "needs-userdata":
      case "saving-userdata":
        return <SteamVersionPicker />;
      case "loading-accounts":
        return (
          <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <p className="text-sm text-text-muted">{t("initialization.loadingAccounts")}</p>
          </div>
        );
      case "accounts-error":
        return (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 rounded-full bg-danger/10 p-3 text-danger">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-bold text-text">{t("initialization.accountsError", { error: "" })}</h3>
            <p className="mb-6 max-w-md text-sm text-text-muted">{initializationError}</p>
            <div className="flex gap-3">
              <button
                onClick={retryInitialization}
                className="h-10 rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                {t("initialization.retry")}
              </button>
              <button
                onClick={chooseAnotherUserdata}
                className="h-10 rounded-lg border border-border bg-surface px-5 text-sm text-text hover:bg-surface-hover"
              >
                {t("initialization.reselectUserdata")}
              </button>
            </div>
          </div>
        );
      case "no-accounts":
        return (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 rounded-full bg-warning/10 p-3 text-warning">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-bold text-text">{t("initialization.noAccounts")}</h3>
            <div className="flex gap-3 mt-4">
              <button
                onClick={retryInitialization}
                className="h-10 rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                {t("initialization.retry")}
              </button>
              <button
                onClick={chooseAnotherUserdata}
                className="h-10 rounded-lg border border-border bg-surface px-5 text-sm text-text hover:bg-surface-hover"
              >
                {t("initialization.reselectUserdata")}
              </button>
            </div>
          </div>
        );
      case "ready":
        return (
          <>
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
            {confirmDelete && (
              <ConfirmDialog
                title={t("library.deleteSelected")}
                message={t("library.deleteSelectedConfirm", { count: useStore.getState().selectedClips.size })}
                danger
                onClose={() => setConfirmDelete(false)}
                onConfirm={() => void useStore.getState().trashSelected()}
              />
            )}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar onClose={requestClose} />
      {renderContent()}
      <ToastViewport />
      <ExportJobCenter />
      {confirmExit && (
        <ConfirmDialog
          title={t("exportJobs.exitTitle")}
          message={t("exportJobs.exitMessage")}
          danger
          onClose={() => setConfirmExit(false)}
          onConfirm={() => {
            setConfirmExit(false);
            setCloseAfterCancel(true);
            const job = useExportJobs.getState().jobs.find((item) => ["queued", "running"].includes(item.status));
            if (job) {
              void useExportJobs.getState().cancel(job.id).then((accepted) => {
                if (!accepted) setCloseAfterCancel(false);
              });
            }
          }}
        />
      )}
    </div>
  );
}
