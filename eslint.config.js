import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/node_modules/**", "**/dist/**", "**/.wrangler/**", "**/coverage/**", "**/worker-configuration.d.ts"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 70, skipBlankLines: true, skipComments: true }],
      "max-depth": ["error", 5],
      complexity: ["error", 10],
    },
  },
  {
    files: ["apps/worker/src/**/*.ts"],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ["apps/worker/scripts/**/*.ts", "**/*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    // 测试里的 describe 回调天然很长，不套函数行数上限
    files: ["**/test/**/*.ts", "**/*.test.ts"],
    rules: { "max-lines-per-function": "off" },
  },
]);
