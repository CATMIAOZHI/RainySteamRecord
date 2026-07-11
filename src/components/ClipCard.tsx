import { memo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useStore } from "../stores/app";
import { tauriBridge, type ClipInfo } from "../lib/tauri-bridge";
import { HealthBadge } from "./ClipDetailsDialog";
import { toast } from "../stores/toast";
import { useExportJobs } from "../stores/export-jobs";
import ConfirmDialog from "./ConfirmDialog";
import { evictThumbnail, loadThumbnail, setThumbnail, subscribeThumbnail } from "../lib/thumbnail-cache";
import { useOverlay } from "../lib/overlay";

function ClipCard({ clip, onPreview, onDetails, orderedFolders }: { clip: ClipInfo; onPreview: (clip: ClipInfo) => void; onDetails: (clip: ClipInfo) => void; orderedFolders: string[] }) {
  const { t } = useTranslation();
  const isSelected = useStore((state) => state.selectedClips.has(clip.folder));
  const toggleClipSelection = useStore((state) => state.toggleClipSelection);
  const selectClipRange = useStore((state) => state.selectClipRange);
  const config = useStore((state) => state.config);
  const startExport = useExportJobs((state) => state.start);
  const loadClips = useStore((state) => state.loadClips);
  const gameIds = useStore((state) => state.gameIds);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbLoading, setThumbLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const regenerateThumbnail = async () => {
    setContextMenu(null);
    setBusy(true);
    setThumbLoading(true);
    evictThumbnail(clip.folder);
    try {
      const path = await tauriBridge.regenerateThumbnail(clip.folder);
      const url = path ? `${tauriBridge.toAssetUrl(path)}?v=${Date.now()}` : null;
      setThumbnail(clip.folder, url);
      setThumbUrl(url);
    } finally {
      setThumbLoading(false);
      setBusy(false);
    }
  };

  const saveGameName = async () => {
    const name = renameValue?.trim();
    if (!name) return;
    setBusy(true);
    const updated = { ...gameIds, [clip.game_id]: name };
    try {
      await tauriBridge.saveGameIds(updated);
      useStore.setState((state) => ({
        gameIds: updated,
        clips: state.clips.map((item) => item.game_id === clip.game_id ? { ...item, game_name: name } : item),
      }));
      setRenameValue(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    let cancelled = false;
    setThumbLoading(true);
    setThumbUrl(null);
    (async () => {
      try {
        const url = await loadThumbnail(clip.folder);
        if (cancelled) return;
        setThumbUrl(url);
      } catch {
        if (!cancelled) setThumbUrl(null);
      } finally {
        if (!cancelled) setThumbLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clip.folder]);

  useEffect(() => subscribeThumbnail(clip.folder, () => {
    setThumbLoading(true);
    void loadThumbnail(clip.folder).then(setThumbUrl).catch(() => setThumbUrl(null)).finally(() => setThumbLoading(false));
  }), [clip.folder]);

  useOverlay(() => {
    if (confirmDelete) setConfirmDelete(false);
    else if (renameValue !== null) setRenameValue(null);
    else setContextMenu(null);
  }, contextMenu !== null || confirmDelete || renameValue !== null);

  return (
    <div
      onClick={(event) => event.shiftKey ? selectClipRange(clip.folder, orderedFolders) : toggleClipSelection(clip.folder)}
      onDoubleClick={() => onPreview(clip)}
      onContextMenu={(event) => {
        event.preventDefault();
        setContextMenu({
          x: Math.min(event.clientX, window.innerWidth - 190),
          y: Math.min(event.clientY, window.innerHeight - 326),
        });
      }}
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
        <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-black/70 px-2 py-1 text-[10px] text-white"><HealthBadge status={clip.health_status} />{t(`health.${clip.health_status}`)}</div>
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
      {contextMenu && createPortal(
        <div
          className="fixed z-[100] min-w-52 rounded-lg border border-border bg-surface p-1 shadow-2xl"
          style={{ left: Math.max(8, contextMenu.x), top: Math.max(8, contextMenu.y) }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button className="w-full rounded-md px-3 py-2 text-left text-sm text-text hover:bg-surface-hover" onClick={() => { setContextMenu(null); onPreview(clip); }}>{t("contextMenu.preview")}</button>
          <button className="w-full rounded-md px-3 py-2 text-left text-sm text-text hover:bg-surface-hover" onClick={() => { setContextMenu(null); onDetails(clip); }}>{t("library.details")}</button>
          <button className="w-full rounded-md px-3 py-2 text-left text-sm text-text hover:bg-surface-hover" onClick={() => { setContextMenu(null); void tauriBridge.openMpvPreview(clip.folder, `${clip.game_name} - ${clip.datetime || clip.folder_name}`); }}>{t("contextMenu.nativePreview")}</button>
          <button className="w-full rounded-md px-3 py-2 text-left text-sm text-text hover:bg-surface-hover" onClick={() => { setContextMenu(null); if (config) void startExport([clip.folder], config.export_path, gameIds); }}>{t("contextMenu.export")}</button>
          <div className="my-1 border-t border-border" />
          <button disabled={busy} className="w-full rounded-md px-3 py-2 text-left text-sm text-text hover:bg-surface-hover disabled:opacity-40" onClick={() => void regenerateThumbnail()}>{t("contextMenu.regenerateThumbnail")}</button>
          <button className="w-full rounded-md px-3 py-2 text-left text-sm text-text hover:bg-surface-hover" onClick={() => { setContextMenu(null); setRenameValue(gameIds[clip.game_id] || clip.game_name); }}>{t("contextMenu.renameGame")}</button>
          <button className="w-full rounded-md px-3 py-2 text-left text-sm text-text hover:bg-surface-hover" onClick={() => { setContextMenu(null); void loadClips(); }}>{t("contextMenu.refresh")}</button>
          <div className="my-1 border-t border-border" />
          <button className="w-full rounded-md px-3 py-2 text-left text-sm text-text hover:bg-surface-hover" onClick={() => { setContextMenu(null); void tauriBridge.openFolder(clip.folder); }}>{t("common.openFileLocation")}</button>
          <button className="w-full rounded-md px-3 py-2 text-left text-sm text-text hover:bg-surface-hover" onClick={() => { setContextMenu(null); void navigator.clipboard.writeText(clip.folder).then(() => toast(t("messages.pathCopied"), "success")); }}>{t("contextMenu.copyPath")}</button>
          <div className="my-1 border-t border-border" />
          <button
            disabled={busy}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-40"
            onClick={() => {
              setContextMenu(null);
               setConfirmDelete(true);
            }}
          >
            {t("contextMenu.delete")}
          </button>
        </div>,
        document.body,
      )}
      {confirmDelete && <ConfirmDialog title={t("contextMenu.delete")} message={t("contextMenu.deleteConfirm", { name: clip.folder_name })} danger onClose={() => setConfirmDelete(false)} onConfirm={() => { setBusy(true); void tauriBridge.trashClip(clip.folder).then(() => loadClips()).finally(() => setBusy(false)); }} />}
      {renameValue !== null && createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50" onClick={() => !busy && setRenameValue(null)}>
          <div className="w-[380px] rounded-2xl border border-border bg-surface p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-base font-semibold text-text">{t("contextMenu.renameGame")}</h3>
            <p className="mt-1 text-xs text-text-muted">App ID: {clip.game_id}</p>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void saveGameName(); }}
              className="mt-4 h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none focus:border-accent"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm text-text hover:bg-surface-hover disabled:opacity-40" onClick={() => setRenameValue(null)}>{t("common.cancel")}</button>
              <button disabled={busy || !renameValue.trim()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40" onClick={() => void saveGameName()}>{t("common.save")}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default memo(ClipCard);
