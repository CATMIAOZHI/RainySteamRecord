import { useStore } from "../stores/app";
import type { ClipInfo } from "../lib/tauri-bridge";

export default function ClipCard({ clip }: { clip: ClipInfo }) {
  const { selectedClips, toggleClipSelection } = useStore();
  const isSelected = selectedClips.has(clip.folder);

  return (
    <div
      onClick={() => toggleClipSelection(clip.folder)}
      className="group relative cursor-pointer overflow-hidden rounded-xl border-2 bg-surface transition-all duration-200"
      style={{
        borderColor: isSelected ? "var(--accent)" : "var(--border)",
        transform: isSelected ? "scale(0.97)" : "scale(1)",
        boxShadow: isSelected ? "0 0 0 2px var(--accent)" : "none",
      }}
    >
      <div className="relative h-44 overflow-hidden bg-surface-2">
        <div className="flex h-full items-center justify-center bg-surface-2">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="opacity-30">
            <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
        <div className="absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-bold text-white">
          {clip.duration}
        </div>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium text-text">{clip.game_name}</p>
        <p className="mt-0.5 truncate text-xs text-text-muted">{clip.datetime || ""}</p>
      </div>
    </div>
  );
}