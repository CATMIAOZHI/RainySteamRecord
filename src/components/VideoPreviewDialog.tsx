import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { tauriBridge, type ClipInfo, type ClipStreamInfo } from "../lib/tauri-bridge";

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const videoBufferRef = useRef<SourceBuffer | null>(null);
  const audioBufferRef = useRef<SourceBuffer | null>(null);
  const streamInfoRef = useRef<ClipStreamInfo | null>(null);
  const feedStateRef = useRef<FeedState>(createFeedState());
  const activeRef = useRef(true);
  const fallbackPathRef = useRef<string | null>(null);
  const fallbackRequestRef = useRef(0);
  const playbackGenerationRef = useRef(0);
  const mseFailedRef = useRef(false);
  const mseFailureRef = useRef<(reason: string) => void>(() => {});
  const usingFallbackRef = useRef(false);
  const fallbackReadyRef = useRef(false);
  const seekTargetRef = useRef<number | null>(null);
  const restartingMseRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

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
            const vInit = await tauriBridge.readSegmentBytes(session.video_init);
            const aInit = await tauriBridge.readSegmentBytes(session.audio_init);
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
        const vData = await tauriBridge.readSegmentBytes(vPath);
        if (!activeRef.current || generation !== playbackGenerationRef.current) return;
        if (videoBufferRef.current) tryAppend(videoBufferRef.current, vData, true);

        if (state.audioChunkIdx < session.audio_chunks.length) {
          const aPath = session.audio_chunks[state.audioChunkIdx];
          const aData = await tauriBridge.readSegmentBytes(aPath);
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

  const fallbackToFFmpeg = useCallback(async (reason: string) => {
    if (!activeRef.current || mseFailedRef.current) return;
    mseFailedRef.current = true;
    console.warn(`MSE playback failed (${reason}), falling back to FFmpeg`);
    const requestId = ++fallbackRequestRef.current;
    playbackGenerationRef.current++;
    usingFallbackRef.current = true;
    fallbackReadyRef.current = false;
    disposeMse();
    setLoading(true);
    setError(null);
    setUsingFallback(true);
    setFallbackUrl(null);
    try {
      const path = await tauriBridge.preparePreview(clip.folder);
      if (!activeRef.current || requestId !== fallbackRequestRef.current) {
        await tauriBridge.cleanupPreview(path);
        return;
      }
      fallbackPathRef.current = path;
      fallbackReadyRef.current = true;
      setFallbackUrl(tauriBridge.toAssetUrl(path));
    } catch (e) {
      if (!activeRef.current || requestId !== fallbackRequestRef.current) return;
      setError(String(e));
      setLoading(false);
    }
  }, [clip.folder, disposeMse]);

  mseFailureRef.current = (reason: string) => {
    void fallbackToFFmpeg(reason);
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

        const vInit = await tauriBridge.readSegmentBytes(initialSession.video_init);
        const aInit = await tauriBridge.readSegmentBytes(initialSession.audio_init);
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
        if (mediaSourceRef.current === ms) fallbackToFFmpeg(String(e));
      }
    }, { once: true });
  }, [fallbackToFFmpeg, feedChunks, tryAppend, flushQueue]);

  useEffect(() => {
    let cancelled = false;
    activeRef.current = true;
    mseFailedRef.current = false;
    usingFallbackRef.current = false;
    fallbackReadyRef.current = false;
    feedStateRef.current = createFeedState();
    streamInfoRef.current = null;
    const generation = ++playbackGenerationRef.current;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setUsingFallback(false);
        setFallbackUrl(null);
        const info = await tauriBridge.getClipStreamInfo(clip.folder);
        if (cancelled) return;
        streamInfoRef.current = info;
        await startMsePlayback(info, generation);
      } catch (e) {
        if (!cancelled) await fallbackToFFmpeg(String(e));
      }
    })();
    return () => {
      cancelled = true;
      activeRef.current = false;
      fallbackRequestRef.current++;
      playbackGenerationRef.current++;
      disposeMse();
      feedStateRef.current = createFeedState();
      if (fallbackPathRef.current) {
        tauriBridge.cleanupPreview(fallbackPathRef.current).catch(() => {});
        fallbackPathRef.current = null;
      }
    };
  }, [clip.folder, disposeMse, startMsePlayback, fallbackToFFmpeg]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || usingFallback) return;
    const onTimeUpdate = () => {
      if (feedStateRef.current.videoDone) return;
      const buffered = video.buffered;
      if (buffered.length === 0) return;
      const bufferedEnd = buffered.end(buffered.length - 1);
      if (bufferedEnd - video.currentTime < PRELOAD_AHEAD_SECONDS) {
        void feedChunks(playbackGenerationRef.current);
      }
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [feedChunks, usingFallback]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || usingFallback) return;
    const onSeeking = () => {
      const info = streamInfoRef.current;
      const target = video.currentTime;
      if (!info || restartingMseRef.current || bufferedAt(video, target)) return;
      const generation = ++playbackGenerationRef.current;
      restartingMseRef.current = true;
      seekTargetRef.current = target;
      disposeMse();
      const state = createFeedStateAt(info, target);
      feedStateRef.current = state;
      void startMsePlayback(info, generation, getBufferStart(info, state), target)
        .catch((e) => fallbackToFFmpeg(String(e)));
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
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("canplay", onProgress);
    };
  }, [disposeMse, fallbackToFFmpeg, startMsePlayback, usingFallback]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onVideoError = () => {
      if (!activeRef.current) return;
      if (restartingMseRef.current) return;
      const reason = video.error?.message || "Video playback error";
      if (usingFallbackRef.current) {
        if (!fallbackReadyRef.current) return;
        setError(reason);
        setLoading(false);
      } else {
        mseFailureRef.current(reason);
      }
    };
    const onCanPlay = () => {
      if (usingFallbackRef.current && fallbackReadyRef.current) setLoading(false);
    };
    video.addEventListener("error", onVideoError);
    video.addEventListener("canplay", onCanPlay);
    return () => {
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("canplay", onCanPlay);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[900px] mx-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
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
            src={usingFallback ? fallbackUrl ?? undefined : undefined}
            controls
            autoPlay
            className={`h-full w-full ${loading || error ? "invisible" : ""}`}
          />
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <p className="text-sm text-text-muted">{t("preview.preparing")}</p>
              </div>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-danger">{t("preview.error")}: {error}</p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex gap-4 text-xs text-text-muted">
            <span>{t("preview.duration")}: {clip.duration}</span>
            <span>{t("preview.type")}: {clip.media_type === "manual" ? t("filter.manualClips") : t("filter.backgroundClips")}</span>
            {usingFallback && <span className="text-amber-500">{t("preview.fallback")}</span>}
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
