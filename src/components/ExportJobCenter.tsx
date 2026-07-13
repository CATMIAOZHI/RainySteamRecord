import { useTranslation } from "react-i18next";
import { tauriBridge } from "../lib/tauri-bridge";
import { useStore } from "../stores/app";
import { formatBytes, useExportJobs, type ExportItemStatus } from "../stores/export-jobs";
import { useOverlay } from "../lib/overlay";

const dotClass: Record<ExportItemStatus, string> = {
  queued: "bg-text-muted", running: "animate-pulse bg-accent", succeeded: "bg-green-500", failed: "bg-red-500", cancelled: "bg-amber-500",
};

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;

export default function ExportJobCenter() {
  const { t } = useTranslation();
  const jobs = useExportJobs((state) => state.jobs);
  const open = useExportJobs((state) => state.panelOpen);
  const setOpen = useExportJobs((state) => state.setPanelOpen);
  const cancel = useExportJobs((state) => state.cancel);
  const retryFailed = useExportJobs((state) => state.retryFailed);
  const removeJob = useExportJobs((state) => state.removeJob);
  const gameIds = useStore((state) => state.gameIds);
  useOverlay(() => setOpen(false), open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-black/30" onClick={() => setOpen(false)}>
      <aside className="flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div><h2 className="font-semibold text-text">{t("exportJobs.title")}</h2><p className="text-xs text-text-muted">{t("exportJobs.subtitle")}</p></div>
          <button className="rounded-lg px-3 py-2 text-text-muted hover:bg-surface-hover" onClick={() => setOpen(false)}>×</button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!jobs.length && <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-text-muted">{t("exportJobs.empty")}</div>}
          {jobs.map((job) => {
            const done = job.items.filter((item) => ["succeeded", "failed", "cancelled"].includes(item.status)).length;
            const failed = job.items.filter((item) => item.status === "failed").length;
            const active = job.status === "queued" || job.status === "running" || job.status === "cancelling";
            return <section key={job.id} className="overflow-hidden rounded-2xl border border-border bg-surface-2">
              <div className="border-b border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-text">{t(`exportJobs.status.${job.status}`)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted">{done}/{job.items.length}</span>
                    {!active && (
                      <button
                        onClick={() => removeJob(job.id)}
                        className="flex h-5 w-5 items-center justify-center rounded text-xs text-text-muted hover:bg-surface hover:text-text"
                        title={t("common.clear")}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${job.items.length ? done / job.items.length * 100 : 0}%` }} /></div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {active && <button disabled={job.status === "cancelling"} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10 disabled:cursor-wait disabled:opacity-50" onClick={() => void cancel(job.id)}>{job.status === "cancelling" ? t("exportJobs.cancelling") : t("exportJobs.cancel")}</button>}
                  {failed > 0 && !active && <button className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover" onClick={() => void retryFailed(job.id, gameIds)}>{t("exportJobs.retryFailed", { count: failed })}</button>}
                  <button className="rounded-lg border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-hover" onClick={() => void tauriBridge.openFolder(job.exportDir)}>{t("exportJobs.openFolder")}</button>
                </div>
              </div>
              <div className="max-h-60 divide-y divide-border overflow-y-auto">
                {job.items.map((item) => <div key={item.clipFolder} className="flex gap-3 px-4 py-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass[item.status]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-text" title={item.clipFolder}>{basename(item.clipFolder)}</div>
                    <div className="mt-0.5 text-[11px] text-text-muted">{item.status === "running" && item.phase ? t(`exportJobs.phase.${item.phase}`) : t(`exportJobs.itemStatus.${item.status}`)}</div>
                    {item.status === "running" && item.phase === "copying" && item.total && item.completed !== undefined && <>
                      <div className="mt-1 text-[11px] text-text-muted">{t("exportJobs.copyProgress", { completed: formatBytes(item.completed), total: formatBytes(item.total) })}</div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, item.completed / item.total * 100)}%` }} /></div>
                    </>}
                    {item.outputPath && <div className="truncate text-[11px] text-text-muted" title={item.outputPath}>{item.outputPath}</div>}
                    {item.error && <div className="mt-1 break-words text-[11px] text-red-500">{item.error}</div>}
                  </div>
                </div>)}
              </div>
              {job.error && <div className="border-t border-border px-4 py-3 text-xs text-red-500">{job.error}</div>}
            </section>;
          })}
        </div>
      </aside>
    </div>
  );
}
