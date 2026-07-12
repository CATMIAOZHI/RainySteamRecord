import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../stores/app";
import { THEMES, applyTheme } from "../lib/theme";
import { tauriBridge, type ReleaseInfo } from "../lib/tauri-bridge";
import { useOverlay } from "../lib/overlay";
import { getVersion } from "@tauri-apps/api/app";

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { config, saveConfig, loadGameIds, gameIds } = useStore();
  const [theme, setTheme] = useState(config?.theme || "rainy");
  const [language, setLanguage] = useState(config?.language || "zh-CN");
  const [exportPath, setExportPath] = useState(config?.export_path || "");
  const [updateInfo, setUpdateInfo] = useState<ReleaseInfo | { error: boolean } | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const savedThemeRef = useRef(config?.theme || "rainy");
  useOverlay(onClose);

  useEffect(() => {
    void getVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      applyTheme(savedThemeRef.current);
    };
  }, []);

  const handleSave = async () => {
    await saveConfig({ theme, language, export_path: exportPath });
    i18n.changeLanguage(language);
    applyTheme(theme);
    savedThemeRef.current = theme;
    onClose();
  };

  const handleExportPath = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true });
    if (selected && typeof selected === "string") {
      setExportPath(selected);
    }
  };

  const handleUpdateCheck = async () => {
    try {
      const info = await tauriBridge.checkForUpdates();
      setUpdateInfo(info);
    } catch {
      setUpdateInfo({ error: true });
    }
  };

  const handleMergeNonSteam = async () => {
    if (!config?.userdata_path) return;
    await tauriBridge.mergeNonSteamGames(config.userdata_path);
    await loadGameIds();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="max-h-[80vh] w-[420px] overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-text">{t("settings.title")}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text">✕</button>
        </div>

        {/* Appearance */}
        <div className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-accent">{t("settings.appearance")}</h3>
          <label className="mb-1 block text-xs text-text-muted">{t("settings.theme")}</label>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none focus:border-accent"
          >
            {THEMES.map((th) => (
              <option key={th.id} value={th.id}>
                {i18n.language === "zh-CN" ? th.name : th.nameEn}
              </option>
            ))}
          </select>

          <label className="mt-3 mb-1 block text-xs text-text-muted">{t("settings.language")}</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none focus:border-accent"
          >
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
          </select>
        </div>

        {/* General */}
        <div className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-accent">{t("settings.general")}</h3>
          <button
            onClick={handleExportPath}
            className="mb-2 h-9 w-full rounded-lg border border-border bg-surface-2 text-sm text-text hover:bg-surface-hover"
          >
            {t("settings.setExportPath")}
          </button>
          {exportPath && <p className="mb-2 truncate text-xs text-text-muted">{exportPath}</p>}
          <button
            onClick={async () => {
              const dir = await tauriBridge.getConfigDir();
              await tauriBridge.openFolder(dir);
            }}
            className="h-9 w-full rounded-lg border border-border bg-surface-2 text-sm text-text hover:bg-surface-hover"
          >
            {t("settings.openConfigFolder")}
          </button>
        </div>

        {/* Game Data */}
        <div className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-accent">{t("settings.gameData")}</h3>
          <button
            onClick={handleMergeNonSteam}
            className="h-9 w-full rounded-lg border border-border bg-surface-2 text-sm text-text hover:bg-surface-hover"
          >
            {t("settings.updateGameIds")}
          </button>
          <p className="mt-1 text-xs text-text-muted">
            {t("settings.gamesCount", { count: Object.keys(gameIds).length })}
          </p>
        </div>

        {/* App */}
        <div className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-accent">{t("settings.appSettings")}</h3>
          <button
            onClick={handleUpdateCheck}
            className="mb-2 h-9 w-full rounded-lg border border-border bg-surface-2 text-sm text-text hover:bg-surface-hover"
          >
            {t("settings.checkForUpdates")}
          </button>
          {updateInfo && !("error" in updateInfo && updateInfo.error) && (
            <p className="mb-2 text-xs text-text-muted">
              {updateInfo && !("error" in updateInfo) && updateInfo.version.replace(/^v/, "") === appVersion.replace(/^v/, "")
                ? t("messages.noUpdate")
                : updateInfo && !("error" in updateInfo) ? t("messages.updateAvailable", { version: updateInfo.version }) : ""}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-text-muted">{t("settings.version")}: {appVersion ? `v${appVersion.replace(/^v/, "")}` : "-"}</span>
          <button
            onClick={handleSave}
            className="rounded-lg bg-accent px-5 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
