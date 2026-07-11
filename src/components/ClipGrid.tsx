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
      {loading ? <div className="flex h-full items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" /></div>
        : filtered.length === 0 ? <div className="flex h-full items-center justify-center text-text-muted">{t("messages.noClips")}</div>
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
