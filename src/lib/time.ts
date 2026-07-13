export function formatTimestamp(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = (safe % 60).toFixed(2).padStart(5, "0");
  return `${hours > 0 ? `${hours.toString().padStart(2, "0")}:` : ""}${minutes.toString().padStart(2, "0")}:${remaining}`;
}

export function parseTimestamp(value: string) {
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => part.trim() === "")) return null;
  const values = parts.map(Number);
  if (values.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 1) return values[0];
  const seconds = values.at(-1)!;
  const minutes = values.at(-2)!;
  if (seconds >= 60 || (parts.length === 3 && minutes >= 60)) return null;
  return parts.length === 2
    ? minutes * 60 + seconds
    : values[0] * 3600 + minutes * 60 + seconds;
}
