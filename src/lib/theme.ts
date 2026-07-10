export const THEMES = [
  { id: "rainy", name: "雨晴", nameEn: "Rainy" },
  { id: "rainy-dark", name: "雨晴暗色", nameEn: "Rainy Dark" },
  { id: "steam-dark", name: "Steam Dark", nameEn: "Steam Dark" },
  { id: "steam-light", name: "Steam Light", nameEn: "Steam Light" },
  { id: "nord", name: "Nord", nameEn: "Nord" },
  { id: "dracula", name: "Dracula", nameEn: "Dracula" },
  { id: "modern-dark", name: "Modern Dark", nameEn: "Modern Dark" },
  { id: "cyberpunk", name: "赛博朋克", nameEn: "Cyberpunk" },
  { id: "neon-blue", name: "霓虹蓝", nameEn: "Neon Blue" },
  { id: "gruvbox", name: "Gruvbox", nameEn: "Gruvbox" },
  { id: "catppuccin-mocha", name: "Catppuccin Mocha", nameEn: "Catppuccin Mocha" },
  { id: "pip-boy", name: "Pip-Boy", nameEn: "Pip-Boy" },
  { id: "crt-amber", name: "CRT Amber", nameEn: "CRT Amber" },
  { id: "high-contrast", name: "高对比", nameEn: "High Contrast" },
];

export function applyTheme(themeId: string): void {
  if (themeId === "rainy") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", themeId);
  }
}