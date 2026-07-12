import { useTranslation } from "react-i18next";
import { getVisibleClips, useStore } from "../stores/app";
import { formatBytes, totalClipSize } from "../lib/clip-library";
import { useExportJobs } from "../stores/export-jobs";
import ConfirmDialog from "./ConfirmDialog";
import { useState } from "react";

export default function BottomBar() {
  const { t } = useTranslation();
  const state = useStore();
  const clips = useStore((state) => state.clips);
  const selectedClips = useStore((state) => state.selectedClips);
  const config = useStore((state) => state.config);
  const gameIds = useStore((state) => state.gameIds);
  const startExport = useExportJobs((state) => state.start);
  const jobs = useExportJobs((state) => state.jobs);
  const setPanelOpen = useExportJobs((state) => state.setPanelOpen);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toggleFilteredSelection = useStore((state) => state.toggleFilteredSelection);
  const clearSelection = useStore((state) => state.clearSelection);
  const trashSelected = useStore((state) => state.trashSelected);
  const regenerateSelectedThumbnails = useStore((state) => state.regenerateSelectedThumbnails);

  const [busyAction, setBusyAction] = useState<"delete" | "regenerate" | null>(null);

  const filtered = getVisibleClips(state);

  const hasSelection = selectedClips.size > 0;
  const hasClips = filtered.length > 0;
  const allFilteredSelected = hasClips && filtered.every((clip) => selectedClips.has(clip.folder));

  const visibleSelectedCount = filtered.filter((clip) => selectedClips.has(clip.folder)).length;
  const hiddenSelectedCount = selectedClips.size - visibleSelectedCount;
  const selectedClipsArray = clips.filter((clip) => selectedClips.has(clip.folder));
  const selectedSizeStr = formatBytes(totalClipSize(selectedClipsArray));

  const handleRegenerate = async () => {
    setBusyAction("regenerate");
    try {
      await regenerateSelectedThumbnails();
    } finally {
      setBusyAction(null);
    }
  };

  const handleTrash = async () => {
    setConfirmDelete(false);
    setBusyAction("delete");
    try {
      await trashSelected();
    } finally {
      setBusyAction(null);
    }
  };

  const isBusy = busyAction !== null;

  const resultSummaryText = hiddenSelectedCount > 0
    ? t("library.resultSummaryDetailedHidden", {
        total: clips.length,
        shown: filtered.length,
        selected: selectedClips.size,
        hidden: hiddenSelectedCount,
        selectedSize: selectedSizeStr,
      })
    : t("library.resultSummaryDetailed", {
        total: clips.length,
        shown: filtered.length,
        selected: selectedClips.size,
        selectedSize: selectedSizeStr,
      });

  return (
    <div className="border-t border-border px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-text-muted">{resultSummaryText}</div>
        <div className="flex gap-2">
          <button
            onClick={() => setPanelOpen(true)}
            disabled={isBusy}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text hover:bg-surface-hover disabled:opacity-40"
          >
            {t("exportJobs.entry", { count: jobs.length })}
          </button>
          <button
            disabled={!hasSelection || isBusy}
            onClick={handleRegenerate}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text hover:bg-surface-hover disabled:opacity-40 flex items-center gap-1.5"
          >
            {busyAction === "regenerate" && (
              <span className="h-3 w-3 animate-spin rounded-full border border-accent border-t-transparent" />
            )}
            {t("library.regenerateSelected")}
          </button>
          <button
            disabled={!hasSelection || isBusy}
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg border border-red-500/40 bg-surface px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-40 flex items-center gap-1.5"
          >
            {busyAction === "delete" && (
              <span className="h-3 w-3 animate-spin rounded-full border border-red-500 border-t-transparent" />
            )}
            {t("library.deleteSelected")}
          </button>
          <button
            onClick={clearSelection}
            disabled={!hasSelection || isBusy}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:bg-surface-hover disabled:opacity-40"
          >
            {t("common.clearSelection")}
          </button>
          <button
            onClick={toggleFilteredSelection}
            disabled={!hasClips || isBusy}
            title={t("common.selectFilteredHint")}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:bg-surface-hover disabled:opacity-40"
          >
            {t(allFilteredSelected ? "common.deselectFiltered" : "common.selectFiltered", { count: filtered.length })}
          </button>
          <button
            onClick={() => config && void startExport([...selectedClips], config.export_path, gameIds)}
            disabled={!hasSelection || !config?.export_path || isBusy}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {t("common.convert")}
          </button>
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={t("library.deleteSelected")}
          message={t("library.deleteSelectedConfirm", { count: selectedClips.size })}
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={handleTrash}
        />
      )}
    </div>
  );
}
