import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: { include: ["proj4"] },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["terminal.local"],
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://127.0.0.1:3001",
        changeOrigin: false,
      },
    },
  },
  build: { chunkSizeWarningLimit: 600 },
});
