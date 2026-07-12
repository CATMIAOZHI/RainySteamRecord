import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { formatBytes } from "../lib/clip-library";
import type { ClipInfo } from "../lib/tauri-bridge";
import { useOverlay } from "../lib/overlay";

export default function ClipDetailsDialog({ clip, onClose }: { clip: ClipInfo; onClose: () => void }) {
  const { t } = useTranslation();
  useOverlay(onClose);
  const rows = [
    [t("library.game"), `${clip.game_name} (${clip.game_id})`],
    [t("library.time"), clip.datetime || "-"],
    [t("library.duration"), clip.duration],
    [t("library.size"), formatBytes(clip.size_bytes)],
    [t("library.resolution"), clip.width && clip.height ? `${clip.width} × ${clip.height}` : "-"],
    [t("library.codecs"), [clip.video_codec, clip.audio_codec].filter(Boolean).join(" / ") || "-"],
    [t("library.frameRate"), clip.frame_rate ? `${clip.frame_rate.toFixed(2)} FPS` : "-"],
    [t("library.sessions"), String(clip.session_count)],
    [t("library.type"), t(`filter.${clip.media_type === "manual" ? "manualClips" : "backgroundClips"}`)],
    [t("library.folder"), clip.folder],
  ];
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-5" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-xl font-semibold text-text">{t("library.details")}</h2><p className="mt-1 break-all text-xs text-text-muted">{clip.folder_name}</p></div>
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-text hover:bg-surface-hover">×</button>
        </div>
        <div className="mt-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
          {rows.map(([label, value]) => <div className="contents" key={label}><span className="text-text-muted">{label}</span><span className="break-all text-text">{value}</span></div>)}
        </div>
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex items-center gap-2"><HealthBadge status={clip.health_status} /><span className="text-sm font-medium text-text">{t(`health.${clip.health_status}`)}</span></div>
          {clip.issues.length > 0 && <ul className="mt-3 space-y-2">{clip.issues.map((issue) => <li key={issue} className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-muted">{issue}</li>)}</ul>}
        </div>
      </div>
    </div>, document.body,
  );
}

export function HealthBadge({ status }: { status: ClipInfo["health_status"] }) {
  const color = status === "checking" ? "var(--text-muted)" : status === "healthy" ? "var(--success)" : status === "warning" ? "var(--warning)" : "var(--danger)";
  return <span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 20%, transparent)` }} />;
}
