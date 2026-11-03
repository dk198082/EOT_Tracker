import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Alias workspace packages so vitest can resolve them without building
    alias: {
      "@workspace/db/schema": resolve(__dirname, "../../lib/db/src/schema/index.ts"),
      "@workspace/db/azure-crm": resolve(__dirname, "../../lib/db/src/azure-crm.ts"),
      "@workspace/db": resolve(__dirname, "../../lib/db/src/index.ts"),
      "@workspace/api-zod": resolve(__dirname, "../../lib/api-zod/src/index.ts"),
    },
  },
});
