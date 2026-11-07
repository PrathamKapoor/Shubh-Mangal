import js from "@eslint/js";
import globals from "globals";
export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "reports/**",
      "test-results/**",
      "playwright-report/**",
      "public/**",
      ".local/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^(React|_)" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
