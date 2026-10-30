import { readFileSync } from "node:fs";
import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    preact(),
    VitePWA({
      // Own service worker, because it also shows the push messages on the lock screen.
      strategies: "injectManifest",
      srcDir: "sw",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.svg", "fonts/*.woff2", "icons/*.png"],
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
      manifest: {
        name: "RepoCity Cockpit",
        short_name: "Cockpit",
        description: "Alles, was in RepoCity passiert, an einem Ort",
        theme_color: "#04060B",
        background_color: "#04060B",
        display: "standalone",
        lang: "de",
        start_url: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
        // Long press on the app icon opens the assistant directly.
        shortcuts: [
          { name: "Assistent", short_name: "Assistent", url: "/assistent", icons: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
        ],
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts", "sw/**/*.test.ts"],
    environment: "node",
  },
});
