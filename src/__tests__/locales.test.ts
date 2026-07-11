import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

describe("locales", () => {
  it("keeps every Chinese translation key in English", () => {
    const zh = JSON.parse(readFileSync(new URL("../../locales/zh-CN.json", import.meta.url), "utf8"));
    const en = JSON.parse(readFileSync(new URL("../../locales/en-US.json", import.meta.url), "utf8"));
    expect(keys(en)).toEqual(expect.arrayContaining(keys(zh)));
  });
});
