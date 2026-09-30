import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Scripts locales del pipeline SUNAT: archivos cortos (se leen y se cambian
  // enteros) y solo TypeScript que Node sabe ejecutar quitando tipos
  // (--experimental-strip-types): sin «parameter properties», enum ni namespace.
  {
    files: ["scripts/local/**/*.mts"],
    rules: {
      "max-lines": ["error", { max: 300, skipBlankLines: false, skipComments: false }],
      "@typescript-eslint/parameter-properties": ["error", { prefer: "class-property" }],
      "no-restricted-syntax": ["error",
        { selector: "TSEnumDeclaration", message: "enum no corre con --experimental-strip-types: usa un objeto `as const`." },
        { selector: "TSModuleDeclaration[kind!='global']", message: "namespace no corre con --experimental-strip-types." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
