import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "src-node/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
  {
    ignores: ["dist/", "src-tauri/", "node_modules/"],
  },
];