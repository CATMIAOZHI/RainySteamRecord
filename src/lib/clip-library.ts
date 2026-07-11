import type { ClipInfo, GameIds } from "./tauri-bridge";

export type SortField = "datetime" | "duration" | "game" | "size";
export type SortDirection = "asc" | "desc";

export interface ClipQuery {
  search: string;
  gameId: string;
  dateFrom: string;
  dateTo: string;
  sortField: SortField;
  sortDirection: SortDirection;
}

export const defaultClipQuery: ClipQuery = {
  search: "",
  gameId: "",
  dateFrom: "",
  dateTo: "",
  sortField: "datetime",
  sortDirection: "desc",
};

export function queryClips(clips: ClipInfo[], query: ClipQuery, gameIds: GameIds = {}) {
  const needle = query.search.trim().toLocaleLowerCase();
  const result = clips.filter((clip) => {
    if (query.gameId && clip.game_id !== query.gameId) return false;
    const date = clip.datetime?.slice(0, 10);
    if (query.dateFrom && (!date || date < query.dateFrom)) return false;
    if (query.dateTo && (!date || date > query.dateTo)) return false;
    if (!needle) return true;
    return [gameIds[clip.game_id], clip.game_name, clip.game_id, clip.folder_name]
      .some((value) => value?.toLocaleLowerCase().includes(needle));
  });
  const direction = query.sortDirection === "asc" ? 1 : -1;
  return result.sort((a, b) => {
    let comparison = 0;
    if (query.sortField === "duration") comparison = a.duration_seconds - b.duration_seconds;
    if (query.sortField === "size") comparison = a.size_bytes - b.size_bytes;
    if (query.sortField === "game") comparison = (gameIds[a.game_id] || a.game_name).localeCompare(gameIds[b.game_id] || b.game_name);
    if (query.sortField === "datetime") comparison = (a.datetime || "").localeCompare(b.datetime || "");
    return comparison * direction || a.folder.localeCompare(b.folder);
  });
}

export function totalClipSize(clips: ClipInfo[]) {
  return clips.reduce((total, clip) => total + clip.size_bytes, 0);
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 || value >= 100 ? 0 : 1)} ${units[index]}`;
}

export function selectRange(folders: string[], anchor: string | null, target: string, selected: Set<string>) {
  if (!anchor) return new Set(selected).add(target);
  const start = folders.indexOf(anchor);
  const end = folders.indexOf(target);
  if (start < 0 || end < 0) return new Set(selected).add(target);
  const next = new Set(selected);
  for (let index = Math.min(start, end); index <= Math.max(start, end); index += 1) next.add(folders[index]);
  return next;
}
