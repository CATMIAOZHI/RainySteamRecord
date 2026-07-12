import { useState } from "react";
import { useTranslation } from "react-i18next";
import { tauriBridge } from "../lib/tauri-bridge";
import { useOverlay } from "../lib/overlay";
import { useStore } from "../stores/app";

export default function SteamVersionPicker() {
  const { t } = useTranslation();
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);
  useOverlay(() => {});

  const initializationStatus = useStore((state) => state.initializationStatus);
  const initializationError = useStore((state) => state.initializationError);
  const saveUserdataPath = useStore((state) => state.saveUserdataPath);

  const isSaving = initializationStatus === "saving-userdata";
  const isBusy = isSaving || busy;
  const displayError = localError || initializationError;

  const handleStandard = async () => {
    if (isBusy) return;
    setBusy(true);
    setLocalError("");
    try {
      const path = await tauriBridge.findSteamUserdata();
      if (path) {
        await saveUserdataPath(path);
      } else {
        setLocalError(t("messages.noSteamFound"));
      }
    } catch (e) {
      setLocalError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleManual = async () => {
    if (isBusy) return;
    setBusy(true);
    setLocalError("");
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true });
      if (selected && typeof selected === "string") {
        const valid = await tauriBridge.validateUserdata(selected);
        if (valid) {
          await saveUserdataPath(selected);
        } else {
          setLocalError(t("steamVersion.invalid"));
        }
      }
    } catch (e) {
      setLocalError(String(e));
    } finally {
      setBusy(false);
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
            disabled={isBusy}
            className="h-11 w-full rounded-lg bg-accent text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBusy ? t("initialization.savingUserdata") : t("steamVersion.standard")}
          </button>
          <button
            onClick={handleManual}
            disabled={isBusy}
            className="h-11 w-full rounded-lg border border-border bg-surface-2 text-sm text-text hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("steamVersion.manual")}
          </button>
        </div>
        {displayError && <p className="mt-3 text-sm text-danger">{displayError}</p>}
      </div>
    </div>
  );
}
