import { create } from "zustand";
import i18n from "../lib/i18n";
import { onConversionEvent, tauriBridge, type ConversionEvent, type ExportPhase, type GameIds, type TrimOptions } from "../lib/tauri-bridge";
import { toast } from "./toast";

export type ExportItemStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ExportJobStatus = "queued" | "running" | "cancelling" | "completed" | "completed-with-errors" | "cancelled" | "failed";

export interface ExportItem {
  clipFolder: string;
  status: ExportItemStatus;
  outputPath?: string;
  error?: string;
  phase?: ExportPhase;
  completed?: number;
  total?: number;
}

export interface ExportJob {
  id: string;
  createdAt: number;
  exportDir: string;
  status: ExportJobStatus;
  items: ExportItem[];
  trim?: TrimOptions;
  error?: string;
}

export function reduceConversionEvent(job: ExportJob, event: ConversionEvent): ExportJob {
  if (event.job_id !== job.id) return job;
  if (event.type === "job-started") return job.status === "cancelling" ? job : { ...job, status: "running" };
  if (event.type === "job-finished") {
    const items = event.status === "cancelled"
      ? job.items.map((item) => item.status === "succeeded" ? item : { ...item, status: "cancelled" as const })
      : job.items;
    return { ...job, status: event.status, items };
  }
  return {
    ...job,
    items: job.items.map((item, index) => {
      if (index !== event.index || item.clipFolder !== event.clip_folder) return item;
      if (event.type === "item-started") return { ...item, status: "running", error: undefined, phase: "preparing", completed: undefined, total: undefined };
      if (event.type === "item-progress") {
        if (item.status !== "running") return item;
        return { ...item, phase: event.phase, completed: event.completed ?? undefined, total: event.total ?? undefined };
      }
      if (event.type === "item-succeeded") return { ...item, status: "succeeded", outputPath: event.output_path, error: undefined, phase: undefined, completed: undefined, total: undefined };
      return { ...item, status: "failed", error: event.error, completed: undefined, total: undefined };
    }),
  };
}

interface ExportJobsState {
  jobs: ExportJob[];
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  start: (folders: string[], exportDir: string, gameIds: GameIds) => Promise<void>;
  startTrim: (folder: string, exportDir: string, gameIds: GameIds, trim: TrimOptions) => Promise<void>;
  cancel: (jobId: string) => Promise<boolean>;
  retryFailed: (jobId: string, gameIds: GameIds) => Promise<void>;
  removeJob: (jobId: string) => void;
  handleEvent: (event: ConversionEvent) => void;
}

const newJobId = () => `export-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

export function formatExportError(error: unknown) {
  const raw = String(error);
  const [code, required, available] = raw.split("|");
  const key = `exportErrors.${code}`;
  if (i18n.exists(key)) {
    return i18n.t(key, {
      required: formatBytes(Number(required)),
      available: formatBytes(Number(available)),
    });
  }
  return raw;
}

export const useExportJobs = create<ExportJobsState>((set, get) => ({
  jobs: [],
  panelOpen: false,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  start: async (folders, exportDir, gameIds) => {
    if (!folders.length || !exportDir) return;
    if (get().jobs.some((job) => job.status === "queued" || job.status === "running" || job.status === "cancelling")) {
      toast(i18n.t("exportJobs.alreadyRunning"), "info");
      set({ panelOpen: true });
      return;
    }
    const job: ExportJob = {
      id: newJobId(),
      createdAt: Date.now(),
      exportDir,
      status: "queued",
      items: folders.map((clipFolder) => ({ clipFolder, status: "queued" })),
    };
    set((state) => ({ jobs: [job, ...state.jobs], panelOpen: true }));
    try {
      await tauriBridge.convertClips(job.id, folders, exportDir, gameIds);
    } catch (error) {
      const message = formatExportError(error);
      set((state) => ({ jobs: state.jobs.map((item) => item.id === job.id ? {
        ...item,
        status: "failed",
        error: message,
        items: item.items.map((entry) => entry.status === "succeeded" ? entry : { ...entry, status: "failed", error: message }),
      } : item) }));
      toast(message, "error");
    }
  },
  startTrim: async (folder, exportDir, gameIds, trim) => {
    if (!folder || !exportDir) return;
    if (get().jobs.some((job) => job.status === "queued" || job.status === "running" || job.status === "cancelling")) {
      toast(i18n.t("exportJobs.alreadyRunning"), "info");
      set({ panelOpen: true });
      return;
    }
    const job: ExportJob = {
      id: newJobId(),
      createdAt: Date.now(),
      exportDir,
      status: "queued",
      trim,
      items: [{ clipFolder: folder, status: "queued" }],
    };
    set((state) => ({ jobs: [job, ...state.jobs], panelOpen: true }));
    try {
      await tauriBridge.convertClips(job.id, [folder], exportDir, gameIds, trim);
    } catch (error) {
      const message = formatExportError(error);
      set((state) => ({ jobs: state.jobs.map((item) => item.id === job.id ? {
        ...item,
        status: "failed",
        error: message,
        items: item.items.map((entry) => ({ ...entry, status: "failed", error: message })),
      } : item) }));
      toast(message, "error");
    }
  },
  cancel: async (jobId) => {
    const job = get().jobs.find((item) => item.id === jobId);
    if (!job || !["queued", "running"].includes(job.status)) return false;
    set((state) => ({ jobs: state.jobs.map((item) => item.id === jobId ? { ...item, status: "cancelling" } : item) }));
    try {
      await tauriBridge.cancelConversion(jobId);
      return true;
    } catch (error) {
      set((state) => ({ jobs: state.jobs.map((item) => item.id === jobId && item.status === "cancelling" ? { ...item, status: job.status } : item) }));
      toast(String(error), "error");
      return false;
    }
  },
  retryFailed: async (jobId, gameIds) => {
    const job = get().jobs.find((item) => item.id === jobId);
    if (!job) return;
    if (get().jobs.some((j) => j.status === "queued" || j.status === "running" || j.status === "cancelling")) {
      toast(i18n.t("exportJobs.alreadyRunning"), "info");
      set({ panelOpen: true });
      return;
    }
    const failedItems = job.items.filter((item) => item.status === "failed");
    const folders = failedItems.map((item) => item.clipFolder);
    if (!folders.length) return;

    const newId = newJobId();
    const newJob: ExportJob = {
      id: newId,
      createdAt: Date.now(),
      exportDir: job.exportDir,
      status: "queued",
      trim: job.trim,
      items: folders.map((clipFolder) => ({ clipFolder, status: "queued" as const })),
    };
    set((state) => ({ jobs: [newJob, ...state.jobs], panelOpen: true }));

    try {
      await tauriBridge.convertClips(newId, folders, job.exportDir, gameIds, job.trim);
    } catch (error) {
      const message = formatExportError(error);
      set((state) => ({
        jobs: state.jobs.map((j) =>
          j.id === newId
            ? {
                ...j,
                status: "failed",
                error: message,
                items: j.items.map((entry) =>
                  entry.status === "queued" ? { ...entry, status: "failed", error: message } : entry
                ),
              }
            : j
        ),
      }));
      toast(message, "error");
    }
  },
  removeJob: (jobId) => {
    set((state) => ({ jobs: state.jobs.filter((job) => job.id !== jobId) }));
  },
  handleEvent: (event) => {
    set((state) => ({ jobs: state.jobs.map((job) => reduceConversionEvent(job, event)) }));
    if (event.type !== "job-finished") return;
    const jobExists = get().jobs.some((job) => job.id === event.job_id);
    if (!jobExists) return;
    if (event.status === "cancelled") toast(i18n.t("exportJobs.cancelledSummary", { succeeded: event.succeeded, total: event.total }), "info");
    else if (event.failed > 0) toast(i18n.t("exportJobs.partialSummary", { succeeded: event.succeeded, failed: event.failed }), "error");
    else toast(i18n.t("exportJobs.successSummary", { count: event.succeeded }), "success");
  },
}));

export function listenForExportJobs() {
  return onConversionEvent((event) => useExportJobs.getState().handleEvent(event));
}
