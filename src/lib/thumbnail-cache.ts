import { tauriBridge } from "./tauri-bridge";

const cache = new Map<string, Promise<string | null>>();
const listeners = new Map<string, Set<() => void>>();
const revisions = new Map<string, number>();

export function loadThumbnail(folder: string) {
  let request = cache.get(folder);
  if (!request) {
    request = tauriBridge.generateThumbnail(folder)
      .then((path) => {
        if (!path) cache.delete(folder);
        if (!path) return null;
        const url = tauriBridge.toAssetUrl(path);
        const revision = revisions.get(folder);
        return revision ? `${url}?v=${revision}` : url;
      })
      .catch((error) => {
        cache.delete(folder);
        throw error;
      });
    cache.set(folder, request);
  }
  return request;
}

export function setThumbnail(folder: string, url: string | null) {
  cache.set(folder, Promise.resolve(url));
  listeners.get(folder)?.forEach((listener) => listener());
}

export function invalidateThumbnail(folder: string) {
  cache.delete(folder);
  revisions.set(folder, Date.now());
  listeners.get(folder)?.forEach((listener) => listener());
}

export function evictThumbnail(folder: string) {
  cache.delete(folder);
}

export function subscribeThumbnail(folder: string, listener: () => void) {
  const folderListeners = listeners.get(folder) || new Set();
  folderListeners.add(listener);
  listeners.set(folder, folderListeners);
  return () => {
    folderListeners.delete(listener);
    if (!folderListeners.size) listeners.delete(folder);
  };
}
