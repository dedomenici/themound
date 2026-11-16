import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.PAGES_BASE ?? "/themound/";

function spaFallback(): Plugin {
  return {
    name: "themound-spa-fallback",
    apply: "build",
    closeBundle() {
      const dist = resolve(here, "dist");
      copyFileSync(resolve(dist, "index.html"), resolve(dist, "404.html"));
      writeFileSync(resolve(dist, ".nojekyll"), "");
    },
  };
}

export default defineConfig({
  base,
  resolve: { alias: { "@": resolve(here, "src") } },
  plugins: [react(), spaFallback()],
});
