import { getCurrentWindow } from "@tauri-apps/api/window";

export default function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="flex h-9 items-center justify-between px-3 select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <span data-tauri-drag-region className="text-sm font-semibold text-accent">
        RainySteamRecord
      </span>
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={() => appWindow.minimize()}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="1" fill="currentColor" /></svg>
        </button>
        <button
          onClick={() => appWindow.close()}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-danger hover:text-white"
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}