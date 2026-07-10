import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { tauriBridge, type ClipInfo, type ClipStreamInfo } from "../lib/tauri-bridge";

const PRELOAD_AHEAD_SECONDS = 10;
const CHUNKS_PER_BATCH = 3;

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

  const startMsePlayback = useCallback(async (info: ClipStreamInfo, generation: number) => {
    if (!window.MediaSource) throw new Error("MSE not supported");

    const firstSession = info.sessions[0];
    if (!firstSession) throw new Error("No stream sessions found");
    const videoMime = `video/mp4; codecs="${firstSession.video_codec}"`;
    const audioMime = `audio/mp4; codecs="${firstSession.audio_codec}"`;

    if (!MediaSource.isTypeSupported(videoMime) || !MediaSource.isTypeSupported(audioMime)) {
      throw new Error(`Unsupported codecs: ${firstSession.video_codec}, ${firstSession.audio_codec}`);
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

        const vInit = await tauriBridge.readSegmentBytes(firstSession.video_init);
        const aInit = await tauriBridge.readSegmentBytes(firstSession.audio_init);
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
    if (!video) return;
    const onVideoError = () => {
      if (!activeRef.current) return;
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
        className="w-[900px] max-w-[90vw] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
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
