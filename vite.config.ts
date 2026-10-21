import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Tauri expects a fixed port and does not want vite obscuring Rust errors.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ command }) => ({
  // Share the native release opt-in without exposing arbitrary process env.
  // Preserve the existing explicit VITE flag for development/browser testing.
  define: command === "build" ? {
    "import.meta.env.VITE_OFFLINE_EXTRACTION": JSON.stringify(
      process.env.HFD_OFFLINE_EXTRACTION === "1"
        ? "1"
        : process.env.VITE_OFFLINE_EXTRACTION ?? "",
    ),
  } : {},
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Tauri targets modern webviews only, so we can ship modern output.
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    setupFiles: ["./src/testing/vitestSetup.ts"],
  },
}));
