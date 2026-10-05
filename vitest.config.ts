import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.test.mjs"],
    // Stage 5 repeatedly reproduced waitFor starvation only under default host-wide fan-out;
    // isolated and constrained runs were green. Keep file isolation, but make the default
    // project command deterministic on shared development hosts.
    maxWorkers: 1,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
