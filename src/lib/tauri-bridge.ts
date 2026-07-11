import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface AppConfig {
  userdata_path: string | null;
  export_path: string;
  theme: string;
  language: string;
}

export interface ClipInfo {
  folder: string;
  folder_name: string;
  game_id: string;
  game_name: string;
  datetime: string | null;
  duration: string;
  duration_seconds: number;
  size_bytes: number;
  width: number | null;
  height: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  frame_rate: number | null;
  session_count: number;
  health_status: "healthy" | "warning" | "error";
  issues: string[];
  media_type: string;
}

export interface ReleaseInfo {
  version: string;
  changelog: string;
  html_url: string;
}

export type GameIds = Record<string, string>;

export interface BatchItemSuccess {
  clip_folder: string;
  output_path: string | null;
}

export interface BatchItemFailure {
  clip_folder: string;
  error: string;
}

export interface BatchResult {
  succeeded: BatchItemSuccess[];
  failed: BatchItemFailure[];
}

export type ConversionEvent =
  | { type: "job-started"; job_id: string; total: number }
  | { type: "item-started"; job_id: string; index: number; clip_folder: string }
  | { type: "item-succeeded"; job_id: string; index: number; clip_folder: string; output_path: string }
  | { type: "item-failed"; job_id: string; index: number; clip_folder: string; error: string }
  | { type: "job-finished"; job_id: string; status: "completed" | "completed-with-errors" | "cancelled"; total: number; succeeded: number; failed: number };

export interface SessionStreamInfo {
  session_dir: string;
  duration_seconds: number;
  segment_duration_seconds: number;
  video_codec: string;
  audio_codec: string;
  video_init: string;
  audio_init: string;
  video_chunks: string[];
  audio_chunks: string[];
}

export interface ClipStreamInfo {
  duration_seconds: number;
  sessions: SessionStreamInfo[];
}

export const tauriBridge = {
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (userdata_path?: string, export_path?: string, theme?: string, language?: string) =>
    invoke<void>("save_config", { userdataPath: userdata_path, exportPath: export_path, theme, language }),
  findSteamUserdata: () => invoke<string | null>("find_steam_userdata"),
  validateUserdata: (folder: string) => invoke<boolean>("validate_userdata", { folder }),
  listSteamIds: (userdataPath: string) => invoke<string[]>("list_steam_ids", { userdataPath }),
  listClips: (userdataPath: string, steamId: string, mediaType: string, useCache?: boolean) =>
    invoke<ClipInfo[]>("list_clips", { userdataPath, steamId, mediaType, useCache }),
  getClipDuration: (clipFolder: string) => invoke<string>("get_clip_duration", { clipFolder }),
  generateThumbnail: (clipFolder: string) => invoke<string | null>("generate_thumbnail", { clipFolder }),
  regenerateThumbnail: (clipFolder: string) => invoke<string | null>("regenerate_thumbnail", { clipFolder }),
  trashClip: (clipFolder: string) => invoke<void>("trash_clip", { clipFolder }),
  trashClips: (clipFolders: string[]) => invoke<BatchResult>("trash_clips", { clipFolders }),
  regenerateThumbnails: (clipFolders: string[]) => invoke<BatchResult>("regenerate_thumbnails", { clipFolders }),
  preparePreview: (clipFolder: string) => invoke<string>("prepare_preview", { clipFolder }),
  openMpvPreview: (clipFolder: string, title: string) => invoke<void>("open_mpv_preview", { clipFolder, title }),
  cleanupPreview: (previewPath: string) => invoke<void>("cleanup_preview", { previewPath }),
  getClipStreamInfo: (clipFolder: string) => invoke<ClipStreamInfo>("get_clip_stream_info", { clipFolder }),
  readSegmentBytes: (filePath: string) => invoke<ArrayBuffer>("read_segment_bytes", { filePath }),
  getGameIds: () => invoke<GameIds>("get_game_ids"),
  saveGameIds: (gameIds: GameIds) => invoke<void>("save_game_ids", { gameIds }),
  fetchGameName: (gameId: string) => invoke<string>("fetch_game_name", { gameId }),
  fetchGameNamesBatch: (gameIds: string[]) => invoke<GameIds>("fetch_game_names_batch", { gameIds }),
  mergeNonSteamGames: (userdataPath: string) => invoke<GameIds>("merge_non_steam_games", { userdataPath }),
  convertClips: (jobId: string, clipFolders: string[], exportDir: string, gameIds: GameIds) =>
    invoke<void>("convert_clips", { jobId, clipFolders, exportDir, gameIds }),
  cancelConversion: (jobId: string) => invoke<void>("cancel_conversion", { jobId }),
  checkForUpdates: () => invoke<ReleaseInfo>("check_for_updates"),
  openFolder: (path: string) => invoke<void>("open_folder", { path }),
  getConfigDir: () => invoke<string>("get_config_dir"),
  toAssetUrl: (filePath: string) => convertFileSrc(filePath),
};

export function onConversionEvent(callback: (data: ConversionEvent) => void) {
  return listen<ConversionEvent>("conversion-event", (event) => callback(event.payload));
}
