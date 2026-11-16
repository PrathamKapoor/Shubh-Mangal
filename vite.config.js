import { defineConfig } from "vite";
import { loadSiteSource } from "./server/site-source.mjs";
import { buildIdentity } from "./server/site-build.mjs";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
const selected = await loadSiteSource(process.env.SITE_SOURCE_CONFIG);
const bootstrap = { name: selected.source.name, assets: selected.source.assets, id: buildIdentity(selected).digest, legacy: selected.source.layoutFile === "public/data/layout.json" };
export default defineConfig(({ command }) => ({
  publicDir: command === "build" && !bootstrap.legacy ? false : "public",
  plugins: [
    { name: "site-build-identity", generateBundle() { this.emitFile({ type: "asset", fileName: "site-build.json", source: JSON.stringify(buildIdentity(selected)) }); } },
    ...(!bootstrap.legacy && command === "build" ? [{
      name: "selected-site-assets",
      transformIndexHtml(html) { return html.replace(/\s*<link rel="icon"[^>]*>/, ""); },
      async generateBundle() {
        const root = await realpath(resolve("public"));
        const selectedAssets = Object.values(selected.source.assets).filter(Boolean).map((url) => [url.slice(1), resolve(root, url.slice(1))]);
        const templates = ["inventory-review-template.csv", "identity-approval-template.csv", "inventory-update-template.csv"]
          .map((name) => [`downloads/${name}`, resolve("docs", name)]);
        for (const [name, source] of [...selectedAssets, ...templates]) {
          if (selectedAssets.some(([asset]) => asset === name)) {
            const actual = await realpath(source), rel = relative(root, actual);
            if (rel.startsWith("..") || isAbsolute(rel)) throw Error(`Selected asset escapes the public directory: ${name}`);
          }
          this.emitFile({ type: "asset", fileName: name, source: await readFile(source) });
        }
      },
    }] : []),
  ],
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
}));
