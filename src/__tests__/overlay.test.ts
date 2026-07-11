import { describe, expect, it, vi } from "vitest";
import { createOverlayRegistry } from "../lib/overlay";

describe("overlay registry", () => {
  it("closes only the top overlay and unregisters independently", () => {
    const registry = createOverlayRegistry();
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registry.register(first);
    const unregisterSecond = registry.register(second);

    expect(registry.hasOpenOverlay()).toBe(true);
    expect(registry.closeTopOverlay()).toBe(true);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();

    unregisterSecond();
    expect(registry.closeTopOverlay()).toBe(true);
    expect(first).toHaveBeenCalledOnce();
    unregisterFirst();
    expect(registry.hasOpenOverlay()).toBe(false);
  });
});
