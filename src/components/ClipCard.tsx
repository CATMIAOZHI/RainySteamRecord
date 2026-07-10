import { useState, useEffect } from "react";
import { useStore } from "../stores/app";
import { tauriBridge, type ClipInfo } from "../lib/tauri-bridge";

export default function ClipCard({ clip, onPreview }: { clip: ClipInfo; onPreview: (clip: ClipInfo) => void }) {
  const { selectedClips, toggleClipSelection } = useStore();
  const isSelected = selectedClips.has(clip.folder);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbLoading, setThumbLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setThumbLoading(true);
    setThumbUrl(null);
    (async () => {
      try {
        const thumbPath = await tauriBridge.generateThumbnail(clip.folder);
        if (cancelled) return;
        if (thumbPath) {
          setThumbUrl(tauriBridge.toAssetUrl(thumbPath));
        }
      } catch {
        if (!cancelled) setThumbUrl(null);
      } finally {
        if (!cancelled) setThumbLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clip.folder]);

  return (
    <div
      onClick={() => toggleClipSelection(clip.folder)}
      onDoubleClick={() => onPreview(clip)}
      className="group relative cursor-pointer overflow-hidden rounded-xl border-2 bg-surface transition-all duration-200"
      style={{
        borderColor: isSelected ? "var(--accent)" : "var(--border)",
        transform: isSelected ? "scale(0.97)" : "scale(1)",
        boxShadow: isSelected ? "0 0 0 2px var(--accent)" : "none",
      }}
    >
      <div className="relative h-44 overflow-hidden bg-surface-2">
        {thumbLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : thumbUrl ? (
          <img
            src={thumbUrl}
            alt={clip.game_name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-surface-2">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="opacity-30">
              <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
        )}
        <div className="absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-bold text-white">
          {clip.duration}
        </div>
        <div className="absolute bottom-2 left-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 opacity-0 transition-opacity group-hover:opacity-100">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="white">
            <path d="M5 3L13 8L5 13Z" />
          </svg>
        </div>
        {isSelected && (
          <div className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 8L7 11L12 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium text-text">{clip.game_name}</p>
        <p className="mt-0.5 truncate text-xs text-text-muted">{clip.datetime || ""}</p>
      </div>
    </div>
  );
}