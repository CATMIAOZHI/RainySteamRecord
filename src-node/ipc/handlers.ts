// RainySteamRecord — IPC method routing
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0.

type Handler = (params: unknown) => Promise<unknown>;

const handlers: Map<string, Handler> = new Map();

handlers.set("ping", async (params) => {
  const p = params as { name?: string };
  return `Hello from Node sidecar! Got: ${p.name ?? "unknown"}`;
});

export async function handleRequest(
  method: string,
  params: unknown,
): Promise<unknown> {
  const handler = handlers.get(method);
  if (!handler) {
    throw new Error(`Unknown method: ${method}`);
  }
  return handler(params);
}

export function registerHandler(method: string, handler: Handler): void {
  handlers.set(method, handler);
}