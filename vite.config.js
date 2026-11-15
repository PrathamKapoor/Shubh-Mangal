import { defineConfig } from "vite";
import { loadSiteSource } from "./server/site-source.mjs";
import { buildIdentity } from "./server/site-build.mjs";
const selected = await loadSiteSource(process.env.SITE_SOURCE_CONFIG);
const bootstrap = { name: selected.source.name, assets: selected.source.assets, id: buildIdentity(selected).digest, legacy: selected.source.layoutFile === "public/data/layout.json" };
export default defineConfig({
  plugins: [{ name: "site-build-identity", generateBundle() { this.emitFile({ type: "asset", fileName: "site-build.json", source: JSON.stringify(buildIdentity(selected)) }); } }],
  define: { "import.meta.env.VITE_SITE_BOOTSTRAP": JSON.stringify(bootstrap) },
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
  build: { chunkSizeWarningLimit: 600, outDir: process.env.SITE_BUILD_DIR || "dist" },
});
