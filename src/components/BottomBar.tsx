import { useTranslation } from "react-i18next";
import { useStore, filterClips } from "../stores/app";

export default function BottomBar() {
  const { t } = useTranslation();
  const clips = useStore((state) => state.clips);
  const selectedGameId = useStore((state) => state.selectedGameId);
  const selectedDateFrom = useStore((state) => state.selectedDateFrom);
  const selectedDateTo = useStore((state) => state.selectedDateTo);
  const selectedClips = useStore((state) => state.selectedClips);
  const isConverting = useStore((state) => state.isConverting);
  const progress = useStore((state) => state.progress);
  const convertClips = useStore((state) => state.convertClips);
  const toggleFilteredSelection = useStore((state) => state.toggleFilteredSelection);
  const clearSelection = useStore((state) => state.clearSelection);

  const filtered = filterClips(clips, selectedGameId, selectedDateFrom, selectedDateTo);

  const hasSelection = selectedClips.size > 0;
  const hasClips = filtered.length > 0;
  const allFilteredSelected = hasClips && filtered.every((clip) => selectedClips.has(clip.folder));

  return (
    <div className="border-t border-border px-5 py-3">
      {progress && (
        <div className="mb-3">
          <div className="mb-1 flex justify-between text-xs text-text-muted">
            <span>{progress.message}</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <div className="flex gap-2">
          <button
            onClick={clearSelection}
            disabled={!hasSelection || isConverting}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:bg-surface-hover disabled:opacity-40"
          >
            {t("common.clearSelection")}
          </button>
          <button
            onClick={toggleFilteredSelection}
            disabled={!hasClips || isConverting}
            title={t("common.selectFilteredHint")}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:bg-surface-hover disabled:opacity-40"
          >
            {t(allFilteredSelected ? "common.deselectFiltered" : "common.selectFiltered", { count: filtered.length })}
          </button>
          <button
            onClick={() => convertClips([...selectedClips])}
            disabled={!hasSelection || isConverting}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {t("common.convert")}
          </button>
        </div>
      </div>
    </div>
  );
}
