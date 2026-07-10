import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore, CLIPS_PER_PAGE } from "../stores/app";
import { type ClipInfo } from "../lib/tauri-bridge";
import ClipCard from "./ClipCard";
import VideoPreviewDialog from "./VideoPreviewDialog";

export default function ClipGrid() {
  const { t } = useTranslation();
  const { clips, selectedGameId, clipIndex, loading } = useStore();
  const [previewClip, setPreviewClip] = useState<ClipInfo | null>(null);

  const filtered = selectedGameId
    ? clips.filter((c) => c.game_id === selectedGameId)
    : clips;

  const visible = filtered.slice(clipIndex, clipIndex + CLIPS_PER_PAGE);

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-4">
      {loading ? (
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : visible.length === 0 ? (
        <div className="flex h-full items-center justify-center text-text-muted">
          {t("messages.noClips")}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {visible.map((clip) => (
            <ClipCard key={clip.folder} clip={clip} onPreview={setPreviewClip} />
          ))}
        </div>
      )}
      {previewClip && (
        <VideoPreviewDialog clip={previewClip} onClose={() => setPreviewClip(null)} />
      )}
    </div>
  );
}