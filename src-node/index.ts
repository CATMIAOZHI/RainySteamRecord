// RainySteamRecord — Node sidecar entry point (JSON-RPC over stdio)
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0.

import * as readline from "node:readline";
import { handleRequest } from "./ipc/handlers.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

interface RpcRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: unknown;
}

export type RpcResponse =
  | { jsonrpc: "2.0"; id: number; result: unknown }
  | { jsonrpc: "2.0"; id: number; error: { code: number; message: string } };

export type RpcEvent = {
  event: string;
  data: unknown;
};

export function sendResponse(resp: RpcResponse): void {
  process.stdout.write(JSON.stringify(resp) + "\n");
}

export function sendEvent(event: string, data: unknown): void {
  const msg: RpcEvent = { event, data };
  process.stdout.write(JSON.stringify(msg) + "\n");
}

rl.on("line", async (line: string) => {
  if (!line.trim()) return;
  let req: RpcRequest;
  try {
    req = JSON.parse(line);
  } catch {
    eprintln(`Failed to parse line: ${line}`);
    return;
  }

  try {
    const result = await handleRequest(req.method, req.params);
    sendResponse({ jsonrpc: "2.0", id: req.id, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    sendResponse({
      jsonrpc: "2.0",
      id: req.id,
      error: { code: -32603, message },
    });
  }
});

function eprintln(msg: string): void {
  process.stderr.write(msg + "\n");
}

// Signal readiness
sendEvent("ready", { pid: process.pid });