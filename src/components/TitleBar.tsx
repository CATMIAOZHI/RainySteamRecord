import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface TitleBarProps {
  onClose: () => void;
}

export default function TitleBar({ onClose }: TitleBarProps) {
  const { t } = useTranslation();
  const appWindow = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void appWindow.isMaximized().then(setMaximized);
    const unlisten = appWindow.onResized(() => {
      void appWindow.isMaximized().then(setMaximized);
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        void appWindow.toggleMaximize();
      }}
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
          aria-label={t("window.minimize")}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="1" fill="currentColor" /></svg>
        </button>
        <button
          onClick={() => void appWindow.toggleMaximize()}
          aria-label={maximized ? t("window.restore") : t("window.maximize")}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text"
        >
          {maximized
            ? <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3.5 3.5V2h6.5v6.5H8.5M2 3.5h6.5V10H2z" fill="none" stroke="currentColor" /></svg>
            : <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" /></svg>}
        </button>
        <button
          onClick={onClose}
          aria-label={t("window.close")}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-danger hover:text-white"
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}
