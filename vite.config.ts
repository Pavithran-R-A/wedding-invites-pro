import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      // Stage 9 adds a second browser document. Both are entries of one build so a single `dist/`
      // carries the app and the render harness, and the harness shares the app's already-hashed
      // dependency chunks rather than a second copy of React that could drift from the one the
      // guest page ran. `render.html` is not linked from anywhere in the product: an entry that no
      // person navigates to, which is the point (§11.6 — there is no public render endpoint).
      input: {
        index: path.resolve(__dirname, "index.html"),
        render: path.resolve(__dirname, "render.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
