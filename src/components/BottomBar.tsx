import { useTranslation } from "react-i18next";
import { getVisibleClips, useStore } from "../stores/app";
import { formatBytes, totalClipSize } from "../lib/clip-library";
import { useExportJobs } from "../stores/export-jobs";
import ConfirmDialog from "./ConfirmDialog";
import { useState } from "react";

export default function BottomBar() {
  const { t } = useTranslation();
  const state = useStore();
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

  const filtered = getVisibleClips(state);

  const hasSelection = selectedClips.size > 0;
  const hasClips = filtered.length > 0;
  const allFilteredSelected = hasClips && filtered.every((clip) => selectedClips.has(clip.folder));

  return (
    <div className="border-t border-border px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-text-muted">{t("library.resultSummary", { count: filtered.length, size: formatBytes(totalClipSize(filtered)) })}</div>
        <div className="flex gap-2">
          <button onClick={() => setPanelOpen(true)} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text hover:bg-surface-hover">{t("exportJobs.entry", { count: jobs.length })}</button>
          <button disabled={!hasSelection} onClick={() => void regenerateSelectedThumbnails()} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text hover:bg-surface-hover disabled:opacity-40">{t("library.regenerateSelected")}</button>
          <button disabled={!hasSelection} onClick={() => setConfirmDelete(true)} className="rounded-lg border border-red-500/40 bg-surface px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-40">{t("library.deleteSelected")}</button>
          <button
            onClick={clearSelection}
            disabled={!hasSelection}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:bg-surface-hover disabled:opacity-40"
          >
            {t("common.clearSelection")}
          </button>
          <button
            onClick={toggleFilteredSelection}
            disabled={!hasClips}
            title={t("common.selectFilteredHint")}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:bg-surface-hover disabled:opacity-40"
          >
            {t(allFilteredSelected ? "common.deselectFiltered" : "common.selectFiltered", { count: filtered.length })}
          </button>
          <button
            onClick={() => config && void startExport([...selectedClips], config.export_path, gameIds)}
            disabled={!hasSelection || !config?.export_path}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {t("common.convert")}
          </button>
        </div>
      </div>
      {confirmDelete && <ConfirmDialog title={t("library.deleteSelected")} message={t("library.deleteSelectedConfirm", { count: selectedClips.size })} danger onClose={() => setConfirmDelete(false)} onConfirm={() => void trashSelected()} />}
    </div>
  );
}
