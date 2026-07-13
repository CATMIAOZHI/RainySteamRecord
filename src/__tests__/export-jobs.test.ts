import { describe, expect, it } from "vitest";
import { formatExportError, reduceConversionEvent, type ExportJob } from "../stores/export-jobs";

const job: ExportJob = {
  id: "job-1",
  createdAt: 1,
  exportDir: "C:\\exports",
  status: "queued",
  items: [{ clipFolder: "a", status: "queued" }, { clipFolder: "b", status: "queued" }],
};

describe("export job reducer", () => {
  it("tracks item output and errors by job id", () => {
    const running = reduceConversionEvent(job, { type: "item-started", job_id: "job-1", index: 0, clip_folder: "a" });
    const succeeded = reduceConversionEvent(running, { type: "item-succeeded", job_id: "job-1", index: 0, clip_folder: "a", output_path: "C:\\exports\\a.mp4" });
    const failed = reduceConversionEvent(succeeded, { type: "item-failed", job_id: "job-1", index: 1, clip_folder: "b", error: "ffmpeg failed" });
    expect(failed.items).toEqual([
      { clipFolder: "a", status: "succeeded", outputPath: "C:\\exports\\a.mp4", error: undefined },
      { clipFolder: "b", status: "failed", error: "ffmpeg failed" },
    ]);
    expect(reduceConversionEvent(failed, { type: "job-started", job_id: "other", total: 2 })).toBe(failed);
  });

  it("marks unfinished items cancelled", () => {
    const result = reduceConversionEvent(job, { type: "job-finished", job_id: "job-1", status: "cancelled", total: 2, succeeded: 0, failed: 0 });
    expect(result.status).toBe("cancelled");
    expect(result.items.map((item) => item.status)).toEqual(["cancelled", "cancelled"]);
  });

  it("requires both index and folder to match", () => {
    const wrongFolder = reduceConversionEvent(job, { type: "item-started", job_id: "job-1", index: 0, clip_folder: "c" });
    expect(wrongFolder.items).toEqual(job.items);
    const wrongIndex = reduceConversionEvent(job, { type: "item-started", job_id: "job-1", index: 1, clip_folder: "a" });
    expect(wrongIndex.items).toEqual(job.items);
  });

  it("does not leave cancelling state when a late start event arrives", () => {
    const cancelling = { ...job, status: "cancelling" as const };
    expect(reduceConversionEvent(cancelling, { type: "job-started", job_id: "job-1", total: 2 }).status).toBe("cancelling");
  });

  it("turns preflight error codes into user-facing messages", () => {
    expect(formatExportError("EXPORT_SOURCE_MISSING|C:\\missing")).not.toContain("C:\\missing");
    expect(formatExportError("EXPORT_SPACE_INSUFFICIENT|1073741824|536870912")).toContain("1.0 GB");
    expect(formatExportError("unknown error")).toBe("unknown error");
  });

  it("tracks progress only for the matching running item", () => {
    const running = reduceConversionEvent(job, { type: "item-started", job_id: "job-1", index: 0, clip_folder: "a" });
    const copying = reduceConversionEvent(running, { type: "item-progress", job_id: "job-1", index: 0, clip_folder: "a", phase: "copying", completed: 50, total: 100 });
    expect(copying.items[0]).toMatchObject({ phase: "copying", completed: 50, total: 100 });
    const muxing = reduceConversionEvent(copying, { type: "item-progress", job_id: "job-1", index: 0, clip_folder: "a", phase: "muxing", completed: null, total: null });
    expect(muxing.items[0]).toMatchObject({ phase: "muxing", completed: undefined, total: undefined });
    const done = reduceConversionEvent(muxing, { type: "item-succeeded", job_id: "job-1", index: 0, clip_folder: "a", output_path: "out.mp4" });
    expect(reduceConversionEvent(done, { type: "item-progress", job_id: "job-1", index: 0, clip_folder: "a", phase: "copying", completed: 1, total: 2 })).toEqual(done);
  });
});
