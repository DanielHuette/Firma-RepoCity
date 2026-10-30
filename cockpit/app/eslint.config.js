import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "dev-dist", "node_modules", "scripts"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-console": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    // The service worker has its own compiler settings (worker globals instead of the DOM).
    files: ["sw/**/*.ts"],
    languageOptions: { parserOptions: { projectService: false, project: "./tsconfig.sw.json" } },
  },
  {
    files: ["src/**/*.{ts,tsx}", "sw/**/*.ts"],
    ignores: ["src/**/*.test.{ts,tsx}", "sw/**/*.test.ts"],
    rules: { "max-lines-per-function": ["error", { max: 30 }] },
  },
);
