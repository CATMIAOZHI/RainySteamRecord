import { describe, expect, it } from "vitest";
import { reduceConversionEvent, type ExportJob } from "../stores/export-jobs";

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

  it("requires both the item index and folder to match", () => {
    const wrongFolder = reduceConversionEvent(job, { type: "item-started", job_id: "job-1", index: 0, clip_folder: "b" });
    const wrongIndex = reduceConversionEvent(job, { type: "item-started", job_id: "job-1", index: 1, clip_folder: "a" });
    expect(wrongFolder.items).toEqual(job.items);
    expect(wrongIndex.items).toEqual(job.items);
  });
});
