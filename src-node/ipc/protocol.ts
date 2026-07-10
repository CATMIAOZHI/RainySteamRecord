// RainySteamRecord — IPC protocol types
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0.

export interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

export type RpcResponse =
  | { jsonrpc: "2.0"; id: number; result: unknown }
  | { jsonrpc: "2.0"; id: number; error: { code: number; message: string } };

export interface RpcEvent {
  event: string;
  data: unknown;
}

export type ClipInfo = {
  folder: string;
  folderName: string;
  gameId: string;
  gameName: string;
  datetime: string | null;
  duration: string;
  thumbnailPath: string | null;
  mediaType: "manual" | "background";
};

export type SteamIdInfo = {
  steamId: string;
  displayName: string;
};

export type ConvertParams = {
  clipFolders: string[];
  exportDir: string;
  gameIds: Record<string, string>;
  exportAll: boolean;
};