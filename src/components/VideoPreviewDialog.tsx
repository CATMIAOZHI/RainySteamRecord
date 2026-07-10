import { useState } from "react";
import { useTranslation } from "react-i18next";
import { tauriBridge, type ClipInfo } from "../lib/tauri-bridge";

export default function VideoPreviewDialog({
  clip,
  onClose,
}: {
  clip: ClipInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useState(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const tempPath = await tauriBridge.preparePreview(clip.folder);
        if (cancelled) return;
        setVideoUrl(tauriBridge.toAssetUrl(tempPath));
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="w-[900px] max-w-[90vw] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold text-text">
            {clip.game_name} — {clip.datetime || clip.folder_name}
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <svg width="14" height="14" viewBox="0 0 14 14">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="relative bg-black" style={{ aspectRatio: "16 / 9" }}>
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <p className="text-sm text-text-muted">{t("preview.preparing")}</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-danger">{t("preview.error")}: {error}</p>
            </div>
          ) : (
            <video
              src={videoUrl ?? undefined}
              controls
              autoPlay
              className="h-full w-full"
            />
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex gap-4 text-xs text-text-muted">
            <span>{t("preview.duration")}: {clip.duration}</span>
            <span>{t("preview.type")}: {clip.media_type === "manual" ? t("filter.manualClips") : t("filter.backgroundClips")}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-surface-2 px-4 py-1.5 text-sm text-text hover:bg-surface-hover"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}