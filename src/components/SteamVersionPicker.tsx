import { useState } from "react";
import { useTranslation } from "react-i18next";
import { tauriBridge } from "../lib/tauri-bridge";
import { useOverlay } from "../lib/overlay";

export default function SteamVersionPicker({ onSelect }: { onSelect: (path: string) => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState("");
  useOverlay(() => {});

  const handleStandard = async () => {
    const path = await tauriBridge.findSteamUserdata();
    if (path) {
      onSelect(path);
    } else {
      setError(t("messages.noSteamFound"));
    }
  };

  const handleManual = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true });
    if (selected && typeof selected === "string") {
      const valid = await tauriBridge.validateUserdata(selected);
      if (valid) {
        onSelect(selected);
      } else {
        setError(t("steamVersion.invalid"));
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[360px] rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-bold text-text">{t("steamVersion.title")}</h2>
        <p className="mb-4 text-sm text-text-muted">{t("steamVersion.question")}</p>
        <div className="flex flex-col gap-3">
          <button
            onClick={handleStandard}
            className="h-11 w-full rounded-lg bg-accent text-sm font-semibold text-white hover:bg-accent-hover"
          >
            {t("steamVersion.standard")}
          </button>
          <button
            onClick={handleManual}
            className="h-11 w-full rounded-lg border border-border bg-surface-2 text-sm text-text hover:bg-surface-hover"
          >
            {t("steamVersion.manual")}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
