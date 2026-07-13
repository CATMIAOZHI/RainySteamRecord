import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { tauriBridge, type ClipInfo, type ClipStreamInfo } from "../lib/tauri-bridge";
import { useOverlay } from "../lib/overlay";
import { formatTimestamp, parseTimestamp } from "../lib/time";
import { useStore } from "../stores/app";
import { useExportJobs } from "../stores/export-jobs";

const PRELOAD_AHEAD_SECONDS = 30;
const CHUNKS_PER_BATCH = 5;

interface FeedState {
  sessionIdx: number;
  videoChunkIdx: number;
  audioChunkIdx: number;
  videoDone: boolean;
  videoQueue: ArrayBuffer[];
  audioQueue: ArrayBuffer[];
  videoAppending: boolean;
  audioAppending: boolean;
  feeding: boolean;
}

function createFeedState(): FeedState {
  return {
    sessionIdx: 0,
    videoChunkIdx: 0,
    audioChunkIdx: 0,
    videoDone: false,
    videoQueue: [],
    audioQueue: [],
    videoAppending: false,
    audioAppending: false,
    feeding: false,
  };
}

function createFeedStateAt(info: ClipStreamInfo, time: number): FeedState {
  const state = createFeedState();
  let sessionStart = 0;
  for (let index = 0; index < info.sessions.length; index++) {
    const session = info.sessions[index];
    const sessionEnd = sessionStart + session.duration_seconds;
    if (time < sessionEnd || index === info.sessions.length - 1) {
      const chunkIndex = Math.max(0, Math.floor((time - sessionStart) / session.segment_duration_seconds));
      state.sessionIdx = index;
      state.videoChunkIdx = Math.min(chunkIndex, Math.max(0, session.video_chunks.length - 1));
      state.audioChunkIdx = Math.min(chunkIndex, Math.max(0, session.audio_chunks.length - 1));
      return state;
    }
    sessionStart = sessionEnd;
  }
  return state;
}

function getBufferStart(info: ClipStreamInfo, state: FeedState) {
  let start = 0;
  for (let index = 0; index < state.sessionIdx; index++) {
    start += info.sessions[index].duration_seconds;
  }
  return start + state.videoChunkIdx * info.sessions[state.sessionIdx].segment_duration_seconds;
}

function bufferedAt(video: HTMLVideoElement, time: number) {
  for (let index = 0; index < video.buffered.length; index++) {
    if (time >= video.buffered.start(index) && time <= video.buffered.end(index)) return true;
  }
  return false;
}

export default function VideoPreviewDialog({
  clip,
  onClose,
}: {
  clip: ClipInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useOverlay(onClose);
  const config = useStore((state) => state.config);
  const gameIds = useStore((state) => state.gameIds);
  const startTrimExport = useExportJobs((state) => state.startTrim);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const videoBufferRef = useRef<SourceBuffer | null>(null);
  const audioBufferRef = useRef<SourceBuffer | null>(null);
  const streamInfoRef = useRef<ClipStreamInfo | null>(null);
  const feedStateRef = useRef<FeedState>(createFeedState());
  const activeRef = useRef(true);
  const playbackGenerationRef = useRef(0);
  const mseFailedRef = useRef(false);
  const mseFailureRef = useRef<(reason: string) => void>(() => {});
  const seekTargetRef = useRef<number | null>(null);
  const restartingMseRef = useRef(false);
  const seekTimerRef = useRef<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nativePreviewRequired, setNativePreviewRequired] = useState(false);
  const [timelineDuration, setTimelineDuration] = useState(Math.max(0, clip.duration_seconds));
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(Math.max(0, clip.duration_seconds));
  const [trimStartInput, setTrimStartInput] = useState(formatTimestamp(0));
  const [trimEndInput, setTrimEndInput] = useState(formatTimestamp(Math.max(0, clip.duration_seconds)));
  const [trimMode, setTrimMode] = useState<"accurate" | "lossless">("accurate");
  const trimDuration = trimEnd - trimStart;
  const trimValid = timelineDuration > 0 && trimStart >= 0 && trimEnd <= timelineDuration + 0.05 && trimDuration >= 0.1;
  const parsedStartInput = parseTimestamp(trimStartInput);
  const parsedEndInput = parseTimestamp(trimEndInput);
  const startInputValid = parsedStartInput !== null && parsedStartInput <= trimEnd - 0.1;
  const endInputValid = parsedEndInput !== null && parsedEndInput >= trimStart + 0.1 && parsedEndInput <= timelineDuration + 0.05;

  useEffect(() => setTrimStartInput(formatTimestamp(trimStart)), [trimStart]);
  useEffect(() => setTrimEndInput(formatTimestamp(trimEnd)), [trimEnd]);

  const applyStartInput = () => {
    if (!startInputValid || parsedStartInput === null) {
      setTrimStartInput(formatTimestamp(trimStart));
      return;
    }
    setTrimStart(parsedStartInput);
    setTrimStartInput(formatTimestamp(parsedStartInput));
  };

  const applyEndInput = () => {
    if (!endInputValid || parsedEndInput === null) {
      setTrimEndInput(formatTimestamp(trimEnd));
      return;
    }
    setTrimEnd(parsedEndInput);
    setTrimEndInput(formatTimestamp(parsedEndInput));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
      if (event.key === " ") {
        event.preventDefault();
        if (video.paused) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 5);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
      } else if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        setTrimStart(Math.max(0, Math.min(video.currentTime, trimEnd - 0.1)));
      } else if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        setTrimEnd(Math.min(timelineDuration, Math.max(video.currentTime, trimStart + 0.1)));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [timelineDuration, trimEnd, trimStart]);

  const disposeMse = useCallback(() => {
    const ms = mediaSourceRef.current;
    mediaSourceRef.current = null;
    videoBufferRef.current = null;
    audioBufferRef.current = null;
    const state = feedStateRef.current;
    state.videoDone = true;
    state.videoQueue = [];
    state.audioQueue = [];

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    if (ms?.readyState === "open") {
      try { ms.endOfStream(); } catch { /* ignore */ }
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const maybeEndMse = useCallback(() => {
    const state = feedStateRef.current;
    const ms = mediaSourceRef.current;
    const videoBuffer = videoBufferRef.current;
    const audioBuffer = audioBufferRef.current;
    if (!state.videoDone || !ms || ms.readyState !== "open" || !videoBuffer || !audioBuffer) return;
    if (state.videoQueue.length || state.audioQueue.length || videoBuffer.updating || audioBuffer.updating) return;
    try {
      ms.endOfStream();
    } catch (e) {
      mseFailureRef.current(String(e));
    }
  }, []);

  const tryAppend = useCallback((buffer: SourceBuffer, data: ArrayBuffer, isVideo: boolean) => {
    const state = feedStateRef.current;
    if (buffer.updating || (isVideo ? state.videoAppending : state.audioAppending)) {
      if (isVideo) state.videoQueue.push(data);
      else state.audioQueue.push(data);
      return;
    }
    try {
      if (isVideo) state.videoAppending = true;
      else state.audioAppending = true;
      buffer.appendBuffer(data);
    } catch (e) {
      if (isVideo) state.videoAppending = false;
      else state.audioAppending = false;
      const currentBuffer = isVideo ? videoBufferRef.current : audioBufferRef.current;
      if (currentBuffer === buffer) mseFailureRef.current(String(e));
    }
  }, []);

  const flushQueue = useCallback((buffer: SourceBuffer, isVideo: boolean) => {
    const state = feedStateRef.current;
    if (isVideo) state.videoAppending = false;
    else state.audioAppending = false;
    if (buffer.updating) return;
    const queue = isVideo ? state.videoQueue : state.audioQueue;
    if (queue.length === 0) {
      maybeEndMse();
      return;
    }
    const next = queue.shift()!;
    try {
      if (isVideo) state.videoAppending = true;
      else state.audioAppending = true;
      buffer.appendBuffer(next);
    } catch (e) {
      if (isVideo) state.videoAppending = false;
      else state.audioAppending = false;
      const currentBuffer = isVideo ? videoBufferRef.current : audioBufferRef.current;
      if (currentBuffer === buffer) mseFailureRef.current(String(e));
    }
  }, [maybeEndMse]);

  const feedChunks = useCallback(async (generation: number) => {
    const state = feedStateRef.current;
    if (generation !== playbackGenerationRef.current || state.feeding || state.videoDone) return;
    state.feeding = true;

    try {
      const info = streamInfoRef.current;
      if (!info) return;
      let fed = 0;

      while (fed < CHUNKS_PER_BATCH) {
        let session = info.sessions[state.sessionIdx];
        if (!session) {
          state.videoDone = true;
          break;
        }

        if (state.videoChunkIdx >= session.video_chunks.length) {
          if (state.audioChunkIdx < session.audio_chunks.length) {
            const aPath = session.audio_chunks[state.audioChunkIdx];
            const aData = await tauriBridge.readSegmentBytes(aPath);
            if (!activeRef.current || generation !== playbackGenerationRef.current) return;
            if (audioBufferRef.current) tryAppend(audioBufferRef.current, aData, false);
            state.audioChunkIdx++;
            fed++;
            continue;
          }
          if (state.sessionIdx < info.sessions.length - 1) {
            state.sessionIdx++;
            state.videoChunkIdx = 0;
            state.audioChunkIdx = 0;
            session = info.sessions[state.sessionIdx];
            const [vInit, aInit] = await Promise.all([
              tauriBridge.readSegmentBytes(session.video_init),
              tauriBridge.readSegmentBytes(session.audio_init),
            ]);
            if (!activeRef.current || generation !== playbackGenerationRef.current) return;
            if (videoBufferRef.current) tryAppend(videoBufferRef.current, vInit, true);
            if (audioBufferRef.current) tryAppend(audioBufferRef.current, aInit, false);
            continue;
          } else {
            state.videoDone = true;
            break;
          }
        }

        const vPath = session.video_chunks[state.videoChunkIdx];
        const aPath = state.audioChunkIdx < session.audio_chunks.length
          ? session.audio_chunks[state.audioChunkIdx]
          : null;
        const [vData, aData] = await Promise.all([
          tauriBridge.readSegmentBytes(vPath),
          aPath ? tauriBridge.readSegmentBytes(aPath) : Promise.resolve(null),
        ]);
        if (!activeRef.current || generation !== playbackGenerationRef.current) return;
        if (videoBufferRef.current) tryAppend(videoBufferRef.current, vData, true);

        if (aData) {
          if (!activeRef.current || generation !== playbackGenerationRef.current) return;
          if (audioBufferRef.current) tryAppend(audioBufferRef.current, aData, false);
          state.audioChunkIdx++;
        }

        state.videoChunkIdx++;
        fed++;
      }
    } catch (e) {
      if (activeRef.current && generation === playbackGenerationRef.current) {
        mseFailureRef.current(String(e));
      }
    } finally {
      state.feeding = false;
      if (generation === playbackGenerationRef.current) maybeEndMse();
    }
  }, [maybeEndMse, tryAppend]);

  const handleMseFailure = useCallback((reason: string) => {
    if (!activeRef.current || mseFailedRef.current) return;
    mseFailedRef.current = true;
    console.warn(`MSE playback failed (${reason}), native preview required`);
    playbackGenerationRef.current++;
    disposeMse();
    setLoading(false);
    setError(null);
    setNativePreviewRequired(true);
  }, [disposeMse]);

  mseFailureRef.current = (reason: string) => {
    handleMseFailure(reason);
  };

  const startMsePlayback = useCallback(async (
    info: ClipStreamInfo,
    generation: number,
    bufferStart = 0,
    seekTarget: number | null = null,
  ) => {
    if (!window.MediaSource) throw new Error("MSE not supported");

    const initialSession = info.sessions[feedStateRef.current.sessionIdx];
    if (!initialSession) throw new Error("No stream sessions found");
    const videoMime = `video/mp4; codecs="${initialSession.video_codec}"`;
    const audioMime = `audio/mp4; codecs="${initialSession.audio_codec}"`;

    if (!MediaSource.isTypeSupported(videoMime) || !MediaSource.isTypeSupported(audioMime)) {
      throw new Error(`Unsupported codecs: ${initialSession.video_codec}, ${initialSession.audio_codec}`);
    }

    const ms = new MediaSource();
    mediaSourceRef.current = ms;
    const video = videoRef.current;
    if (!video) throw new Error("Video element unavailable");
    const url = URL.createObjectURL(ms);
    objectUrlRef.current = url;
    video.src = url;

    ms.addEventListener("sourceopen", async () => {
      if (mediaSourceRef.current !== ms) return;
      try {
        const vBuf = ms.addSourceBuffer(videoMime);
        const aBuf = ms.addSourceBuffer(audioMime);
        vBuf.mode = "sequence";
        aBuf.mode = "sequence";
        ms.duration = info.duration_seconds;
        vBuf.timestampOffset = bufferStart;
        aBuf.timestampOffset = bufferStart;
        videoBufferRef.current = vBuf;
        audioBufferRef.current = aBuf;

        vBuf.addEventListener("updateend", () => flushQueue(vBuf, true));
        aBuf.addEventListener("updateend", () => flushQueue(aBuf, false));
        const onBufferError = () => {
          if (mediaSourceRef.current === ms) mseFailureRef.current("SourceBuffer error");
        };
        vBuf.addEventListener("error", onBufferError);
        aBuf.addEventListener("error", onBufferError);
        vBuf.addEventListener("abort", onBufferError);
        aBuf.addEventListener("abort", onBufferError);

        const [vInit, aInit] = await Promise.all([
          tauriBridge.readSegmentBytes(initialSession.video_init),
          tauriBridge.readSegmentBytes(initialSession.audio_init),
        ]);
        if (!activeRef.current || generation !== playbackGenerationRef.current || mediaSourceRef.current !== ms) return;

        const onVInitDone = () => {
          vBuf.removeEventListener("updateend", onVInitDone);
          if (generation === playbackGenerationRef.current && mediaSourceRef.current === ms) {
            void feedChunks(generation);
          }
        };
        vBuf.addEventListener("updateend", onVInitDone);

        tryAppend(vBuf, vInit, true);
        if (mseFailedRef.current) return;
        tryAppend(aBuf, aInit, false);
        if (mseFailedRef.current) return;

        setLoading(false);
        if (seekTarget !== null) {
          seekTargetRef.current = seekTarget;
          video.currentTime = seekTarget;
        } else {
          restartingMseRef.current = false;
        }
        video.play().catch(() => {});
      } catch (e) {
        if (mediaSourceRef.current === ms) handleMseFailure(String(e));
      }
    }, { once: true });
  }, [handleMseFailure, feedChunks, tryAppend, flushQueue]);

  useEffect(() => {
    let cancelled = false;
    activeRef.current = true;
    mseFailedRef.current = false;
    feedStateRef.current = createFeedState();
    streamInfoRef.current = null;
    const generation = ++playbackGenerationRef.current;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setNativePreviewRequired(false);
        const info = await tauriBridge.getClipStreamInfo(clip.folder);
        if (cancelled) return;
        streamInfoRef.current = info;
        setTimelineDuration(info.duration_seconds);
        setTrimEnd((current) => current > 0 ? Math.min(current, info.duration_seconds) : info.duration_seconds);
        await startMsePlayback(info, generation);
      } catch (e) {
        if (!cancelled) handleMseFailure(String(e));
      }
    })();
    return () => {
      cancelled = true;
      activeRef.current = false;
      playbackGenerationRef.current++;
      disposeMse();
      feedStateRef.current = createFeedState();
      if (seekTimerRef.current !== null) {
        window.clearTimeout(seekTimerRef.current);
        seekTimerRef.current = null;
      }
    };
  }, [clip.folder, disposeMse, startMsePlayback, handleMseFailure]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => {
      if (feedStateRef.current.videoDone) return;
      const buffered = video.buffered;
      if (buffered.length === 0) return;
      const bufferedEnd = buffered.end(buffered.length - 1);
      if (bufferedEnd - video.currentTime < PRELOAD_AHEAD_SECONDS) {
        void feedChunks(playbackGenerationRef.current);
      }
      const removeEnd = video.currentTime - 60;
      if (removeEnd <= 0) return;
      const state = feedStateRef.current;
      const videoBuffer = videoBufferRef.current;
      const audioBuffer = audioBufferRef.current;
      try {
        if (videoBuffer && !videoBuffer.updating && !state.videoAppending && state.videoQueue.length === 0 && videoBuffer.buffered.length > 0 && videoBuffer.buffered.start(0) < removeEnd) {
          videoBuffer.remove(0, removeEnd);
        }
        if (audioBuffer && !audioBuffer.updating && !state.audioAppending && state.audioQueue.length === 0 && audioBuffer.buffered.length > 0 && audioBuffer.buffered.start(0) < removeEnd) {
          audioBuffer.remove(0, removeEnd);
        }
      } catch {
        return;
      }
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [feedChunks]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onSeeking = () => {
      const info = streamInfoRef.current;
      const target = video.currentTime;
      if (restartingMseRef.current) return;
      if (seekTimerRef.current !== null) {
        window.clearTimeout(seekTimerRef.current);
        seekTimerRef.current = null;
      }
      if (!info || bufferedAt(video, target)) return;
      seekTimerRef.current = window.setTimeout(() => {
        seekTimerRef.current = null;
        const generation = ++playbackGenerationRef.current;
        restartingMseRef.current = true;
        seekTargetRef.current = target;
        disposeMse();
        const state = createFeedStateAt(info, target);
        feedStateRef.current = state;
        void startMsePlayback(info, generation, getBufferStart(info, state), target)
          .catch((e) => handleMseFailure(String(e)));
      }, 150);
    };
    const onProgress = () => {
      const target = seekTargetRef.current;
      if (target === null || !bufferedAt(video, target)) return;
      seekTargetRef.current = null;
      restartingMseRef.current = false;
      video.currentTime = target;
      video.play().catch(() => {});
    };
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("progress", onProgress);
    video.addEventListener("canplay", onProgress);
    return () => {
      if (seekTimerRef.current !== null) {
        window.clearTimeout(seekTimerRef.current);
      }
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("canplay", onProgress);
    };
  }, [disposeMse, handleMseFailure, startMsePlayback]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onVideoError = () => {
      if (!activeRef.current) return;
      if (restartingMseRef.current) return;
      const reason = video.error?.message || "Video playback error";
      mseFailureRef.current(reason);
    };
    video.addEventListener("error", onVideoError);
    return () => {
      video.removeEventListener("error", onVideoError);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="mx-4 max-h-[calc(100vh-2rem)] w-full max-w-[900px] overflow-y-auto rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold text-text">
            {clip.game_name} — {clip.datetime || clip.folder_name}
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <svg width="14" height="14" viewBox="0 0 14 14">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="relative bg-black" style={{ aspectRatio: "16 / 9" }}>
          <video
            ref={videoRef}
            controls
            autoPlay
            onDoubleClick={() => {
              const video = videoRef.current;
              if (!video) return;
              if (!document.fullscreenElement) {
                video.requestFullscreen().catch(() => {});
              } else {
                document.exitFullscreen().catch(() => {});
              }
            }}
            className={`h-full w-full ${loading || error || nativePreviewRequired ? "invisible" : ""}`}
          />
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <p className="text-sm text-text-muted">{t("preview.preparing")}</p>
              </div>
            </div>
          ) : nativePreviewRequired ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <div className="max-w-md">
                <p className="text-sm font-semibold text-white">{t("preview.nativeRequired")}</p>
                <p className="mt-2 text-xs leading-5 text-white/65">{t("preview.nativeRequiredHint")}</p>
                {error && <p className="mt-2 text-xs text-red-400">{t("preview.error")}: {error}</p>}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    void tauriBridge.openMpvPreview(
                      clip.folder,
                      `${clip.game_name} - ${clip.datetime || clip.folder_name}`,
                    ).catch((reason) => setError(String(reason)));
                  }}
                  className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
                >
                  {t("preview.openNative")}
                </button>
              </div>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-danger">{t("preview.error")}: {error}</p>
            </div>
          ) : null}
        </div>

        <div className="border-t border-border bg-surface-2/40 px-5 py-4">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-text">{t("trim.title")}</h3>
              <p className="mt-0.5 text-xs text-text-muted">{t("trim.hint")}</p>
            </div>
            <div className="rounded-md bg-accent/10 px-2.5 py-1 font-mono text-xs font-semibold text-accent">
              {formatTimestamp(Math.max(0, trimDuration))}
            </div>
          </div>

          <div className="relative mb-4 h-2 overflow-hidden rounded-full bg-border">
            <div
              className="absolute inset-y-0 rounded-full bg-accent"
              style={{
                left: `${timelineDuration > 0 ? (trimStart / timelineDuration) * 100 : 0}%`,
                width: `${timelineDuration > 0 ? Math.max(0, (trimDuration / timelineDuration) * 100) : 0}%`,
              }}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <label htmlFor="trim-start" className="font-semibold text-text">{t("trim.start")}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={t("trim.startInput")}
                  aria-invalid={!startInputValid}
                  value={trimStartInput}
                  onChange={(event) => setTrimStartInput(event.target.value)}
                  onBlur={applyStartInput}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") setTrimStartInput(formatTimestamp(trimStart));
                  }}
                  className={`w-28 rounded border bg-surface-2 px-2 py-1 text-right font-mono text-xs text-text outline-none focus:border-accent ${startInputValid ? "border-border" : "border-danger"}`}
                />
              </div>
              <input
                id="trim-start"
                type="range"
                min="0"
                max={timelineDuration || 0}
                step="0.01"
                value={Math.min(trimStart, timelineDuration)}
                onChange={(event) => setTrimStart(Math.min(Number(event.target.value), Math.max(0, trimEnd - 0.1)))}
                className="w-full accent-[var(--color-accent)]"
              />
              <button
                type="button"
                onClick={() => setTrimStart(Math.min(videoRef.current?.currentTime ?? 0, Math.max(0, trimEnd - 0.1)))}
                className="mt-2 w-full rounded-md border border-border px-2 py-1.5 text-xs font-medium text-text hover:bg-surface-hover"
              >
                {t("trim.setStart")}
              </button>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <label htmlFor="trim-end" className="font-semibold text-text">{t("trim.end")}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={t("trim.endInput")}
                  aria-invalid={!endInputValid}
                  value={trimEndInput}
                  onChange={(event) => setTrimEndInput(event.target.value)}
                  onBlur={applyEndInput}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") setTrimEndInput(formatTimestamp(trimEnd));
                  }}
                  className={`w-28 rounded border bg-surface-2 px-2 py-1 text-right font-mono text-xs text-text outline-none focus:border-accent ${endInputValid ? "border-border" : "border-danger"}`}
                />
              </div>
              <input
                id="trim-end"
                type="range"
                min="0"
                max={timelineDuration || 0}
                step="0.01"
                value={Math.min(trimEnd, timelineDuration)}
                onChange={(event) => setTrimEnd(Math.max(Number(event.target.value), trimStart + 0.1))}
                className="w-full accent-[var(--color-accent)]"
              />
              <button
                type="button"
                onClick={() => setTrimEnd(Math.max(videoRef.current?.currentTime ?? timelineDuration, trimStart + 0.1))}
                className="mt-2 w-full rounded-md border border-border px-2 py-1.5 text-xs font-medium text-text hover:bg-surface-hover"
              >
                {t("trim.setEnd")}
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1">
              <div className="mb-1.5 text-xs font-semibold text-text">{t("trim.mode")}</div>
              <div className="inline-flex rounded-lg border border-border bg-surface p-1">
                {(["accurate", "lossless"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTrimMode(mode)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${trimMode === mode ? "bg-accent text-white" : "text-text-muted hover:text-text"}`}
                  >
                    {t(`trim.${mode}`)}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-text-muted">{t(`trim.${trimMode}Hint`)}</p>
            </div>
            <button
              type="button"
              disabled={!trimValid || !config}
              onClick={() => {
                if (!config || !trimValid) return;
                void startTrimExport(clip.folder, config.export_path, gameIds, {
                  start_seconds: trimStart,
                  end_seconds: trimEnd,
                  mode: trimMode,
                });
              }}
              className="h-10 rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("trim.export")}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex gap-4 text-xs text-text-muted">
            <span>{t("preview.duration")}: {clip.duration}</span>
            <span>{t("preview.type")}: {clip.media_type === "manual" ? t("filter.manualClips") : t("filter.backgroundClips")}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-surface-2 px-4 py-1.5 text-sm text-text hover:bg-surface-hover"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
