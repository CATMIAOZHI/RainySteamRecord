/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-hover": "var(--surface-hover)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        text: "var(--text)",
        "text-muted": "var(--text-muted)",
        border: "var(--border)",
      },
    },
  },
  plugins: [],
};