import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { getVisibleClips, useStore } from "../stores/app";
import { type ClipInfo } from "../lib/tauri-bridge";
import ClipCard from "./ClipCard";
import VideoPreviewDialog from "./VideoPreviewDialog";
import ClipDetailsDialog from "./ClipDetailsDialog";

export default function ClipGrid() {
  const { t } = useTranslation();
  const clips = useStore((state) => state.clips);
  const gameIds = useStore((state) => state.gameIds);
  const search = useStore((state) => state.search);
  const selectedSteamId = useStore((state) => state.selectedSteamId);
  const selectedMediaType = useStore((state) => state.selectedMediaType);
  const selectedGameId = useStore((state) => state.selectedGameId);
  const selectedDateFrom = useStore((state) => state.selectedDateFrom);
  const selectedDateTo = useStore((state) => state.selectedDateTo);
  const sortField = useStore((state) => state.sortField);
  const sortDirection = useStore((state) => state.sortDirection);
  const loading = useStore((state) => state.loading);
  const scanning = useStore((state) => state.scanning);
  const detailedScanError = useStore((state) => state.detailedScanError);
  const clearFilters = useStore((state) => state.clearFilters);
  const loadClips = useStore((state) => state.loadClips);

  const filtered = useMemo(() => getVisibleClips({ clips, gameIds, search, selectedGameId, selectedDateFrom, selectedDateTo, sortField, sortDirection }), [clips, gameIds, search, selectedGameId, selectedDateFrom, selectedDateTo, sortField, sortDirection]);
  const orderedFolders = useMemo(() => filtered.map((clip) => clip.folder), [filtered]);
  const [previewClip, setPreviewClip] = useState<ClipInfo | null>(null);
  const [detailClip, setDetailClip] = useState<ClipInfo | null>(null);
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = Math.max(1, Math.floor((width + 16) / 256));
  const rowCount = Math.ceil(filtered.length / columns);
  const virtualizer = useVirtualizer({ count: rowCount, getScrollElement: () => scrollRef.current, estimateSize: () => 264, overscan: 2 });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [clips, gameIds, search, selectedSteamId, selectedMediaType, selectedGameId, selectedDateFrom, selectedDateTo, sortField, sortDirection]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-4">
      {detailedScanError && (
        <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger shadow-sm">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{t("library.detailedScanError", { error: detailedScanError })}</span>
          </div>
          <button
            onClick={() => void loadClips()}
            className="flex-shrink-0 rounded bg-danger/10 px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/20"
          >
            {t("library.retryScan")}
          </button>
        </div>
      )}
      {scanning && <div className="sticky top-0 z-20 mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface/95 px-3 py-2 text-xs text-text-muted shadow-sm backdrop-blur"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />{t("messages.scanningDetails")}</div>}
      {loading ? <div className="flex h-full items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" /></div>
        : clips.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center text-text-muted">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-40">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <circle cx="12" cy="12" r="4" />
            </svg>
            <p className="text-sm font-semibold">{t("messages.noClips")}</p>
            <p className="mt-1 max-w-sm text-xs opacity-70">{t("library.noClipsDetail")}</p>
          </div>
        )
        : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center text-text-muted">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-40">
              <circle cx="11" cy="11" r="7" />
              <line x1="20" y1="20" x2="16.65" y2="16.65" />
            </svg>
            <p className="text-sm font-semibold">{t("library.noFilteredResults")}</p>
            <button
              onClick={clearFilters}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover"
            >
              {t("library.clearFilters")}
            </button>
          </div>
        )
        : <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => (
            <div key={row.key} className="absolute left-0 top-0 grid w-full gap-4" style={{ transform: `translateY(${row.start}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {filtered.slice(row.index * columns, row.index * columns + columns).map((clip) => (
                <ClipCard key={clip.folder} clip={clip} onPreview={setPreviewClip} onDetails={setDetailClip} orderedFolders={orderedFolders} />
              ))}
            </div>
          ))}
        </div>}
      {previewClip && <VideoPreviewDialog clip={previewClip} onClose={() => setPreviewClip(null)} />}
      {detailClip && <ClipDetailsDialog clip={detailClip} onClose={() => setDetailClip(null)} />}
    </div>
  );
}
