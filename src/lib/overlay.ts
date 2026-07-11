import { useEffect, useRef } from "react";

type CloseOverlay = () => void;

export function createOverlayRegistry() {
  const overlays: { id: symbol; close: CloseOverlay }[] = [];

  return {
    register(close: CloseOverlay) {
      const entry = { id: Symbol(), close };
      overlays.push(entry);
      return () => {
        const index = overlays.findIndex((overlay) => overlay.id === entry.id);
        if (index >= 0) overlays.splice(index, 1);
      };
    },
    hasOpenOverlay() {
      return overlays.length > 0;
    },
    closeTopOverlay() {
      const overlay = overlays.at(-1);
      if (!overlay) return false;
      overlay.close();
      return true;
    },
  };
}

export const overlayRegistry = createOverlayRegistry();

export function useOverlay(onClose: CloseOverlay, enabled = true) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => enabled ? overlayRegistry.register(() => closeRef.current()) : undefined, [enabled]);
}
