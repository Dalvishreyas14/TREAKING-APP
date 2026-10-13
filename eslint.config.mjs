import next from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

/**
 * Flat ESLint config.
 *
 * Next 16 removed `next lint`, so linting is driven by the ESLint CLI directly.
 * `core-web-vitals` adds the accessibility and React correctness rules on top
 * of the base config, and the TypeScript preset supplies type-aware linting.
 */
export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
    ],
  },
  ...next,
  ...nextTs,
  {
    // Type-aware rules can only run where the parser can produce type
    // information, so they are scoped to TypeScript sources rather than being
    // applied globally and blowing up on the config file itself.
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        // eslint-config-next supplies the TypeScript parser but not the project
        // wiring, without which every type-aware rule errors on load.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Unused args are commonly prefixed with `_` in callbacks.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      // `any` defeats the point of a strict TypeScript project.
      "@typescript-eslint/no-explicit-any": "error",
      // Floating promises hide unhandled rejections in async handlers.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    // Seeds and tests legitimately reach for looser typing and console output.
    files: ["prisma/**/*.ts", "tests/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
);
