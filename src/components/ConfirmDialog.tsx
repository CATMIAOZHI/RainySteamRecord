import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useOverlay } from "../lib/overlay";

export default function ConfirmDialog({ title, message, danger, onConfirm, onClose }: { title: string; message: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  useOverlay(onClose);
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-base font-semibold text-text">{title}</h2>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-text-muted">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded-lg border border-border px-4 py-2 text-sm text-text hover:bg-surface-hover" onClick={onClose}>{t("common.cancel")}</button>
          <button className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${danger ? "bg-red-500 hover:bg-red-600" : "bg-accent hover:bg-accent-hover"}`} onClick={() => { onClose(); onConfirm(); }}>{t("common.confirm")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
