import { useTranslation } from "react-i18next";
import { useStore, CLIPS_PER_PAGE } from "../stores/app";

export default function BottomBar() {
  const { t } = useTranslation();
  const {
    clips,
    selectedGameId,
    clipIndex,
    selectedClips,
    isConverting,
    progress,
    convertClips,
    exportAll,
    clearSelection,
    prevPage,
    nextPage,
  } = useStore();

  const filtered = selectedGameId
    ? clips.filter((c) => c.game_id === selectedGameId)
    : clips;

  const hasSelection = selectedClips.size > 0;
  const hasClips = filtered.length > 0;
  const canPrev = clipIndex > 0;
  const canNext = clipIndex + CLIPS_PER_PAGE < filtered.length;

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

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            onClick={prevPage}
            disabled={!canPrev || isConverting}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:bg-surface-hover disabled:opacity-40"
          >
            {t("common.previous")}
          </button>
          <button
            onClick={nextPage}
            disabled={!canNext || isConverting}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:bg-surface-hover disabled:opacity-40"
          >
            {t("common.next")}
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={clearSelection}
            disabled={!hasSelection || isConverting}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:bg-surface-hover disabled:opacity-40"
          >
            {t("common.clearSelection")}
          </button>
          <button
            onClick={() => exportAll()}
            disabled={!hasClips || isConverting}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:bg-surface-hover disabled:opacity-40"
          >
            {t("common.exportAll")}
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