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
  media_type: string;
}

export interface ReleaseInfo {
  version: string;
  changelog: string;
  html_url: string;
}

export type GameIds = Record<string, string>;

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
  convertClips: (clipFolders: string[], exportDir: string, gameIds: GameIds) =>
    invoke<boolean>("convert_clips", { clipFolders, exportDir, gameIds }),
  cancelConversion: () => invoke<void>("cancel_conversion"),
  checkForUpdates: () => invoke<ReleaseInfo>("check_for_updates"),
  openFolder: (path: string) => invoke<void>("open_folder", { path }),
  getConfigDir: () => invoke<string>("get_config_dir"),
  toAssetUrl: (filePath: string) => convertFileSrc(filePath),
};

export function onConversionProgress(callback: (data: { current: number; total: number; percent: number; message: string }) => void) {
  return listen<{ current: number; total: number; percent: number; message: string }>("conversion-progress", (event) => callback(event.payload));
}

export function onConversionDone(callback: (data: { success: boolean; message: string }) => void) {
  return listen<{ success: boolean; message: string }>("conversion-done", (event) => callback(event.payload));
}
