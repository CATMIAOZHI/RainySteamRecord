import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore, filterClips } from "../stores/app";
import { type ClipInfo } from "../lib/tauri-bridge";
import ClipCard from "./ClipCard";
import VideoPreviewDialog from "./VideoPreviewDialog";

const CLIPS_PER_BATCH = 24;

export default function ClipGrid() {
  const { t } = useTranslation();
  const clips = useStore((state) => state.clips);
  const selectedGameId = useStore((state) => state.selectedGameId);
  const selectedDateFrom = useStore((state) => state.selectedDateFrom);
  const selectedDateTo = useStore((state) => state.selectedDateTo);
  const loading = useStore((state) => state.loading);
  const [previewClip, setPreviewClip] = useState<ClipInfo | null>(null);
  const [visibleCount, setVisibleCount] = useState(CLIPS_PER_BATCH);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const filtered = filterClips(clips, selectedGameId, selectedDateFrom, selectedDateTo);
  const visible = filtered.slice(0, visibleCount);

  useEffect(() => {
    setVisibleCount(CLIPS_PER_BATCH);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [clips, selectedGameId, selectedDateFrom, selectedDateTo]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || visible.length >= filtered.length) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount((count) => Math.min(count + CLIPS_PER_BATCH, filtered.length));
        }
      },
      { root, rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filtered.length, visible.length]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-4">
      {loading ? (
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : visible.length === 0 ? (
        <div className="flex h-full items-center justify-center text-text-muted">
          {t("messages.noClips")}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {visible.map((clip) => (
              <ClipCard key={clip.folder} clip={clip} onPreview={setPreviewClip} />
            ))}
          </div>
          <div ref={sentinelRef} className="py-4 text-center text-xs text-text-muted">
            {t("messages.clipCount", { shown: visible.length, total: filtered.length })}
          </div>
        </>
      )}
      {previewClip && (
        <VideoPreviewDialog clip={previewClip} onClose={() => setPreviewClip(null)} />
      )}
    </div>
  );
}
