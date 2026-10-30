import { readFileSync } from "node:fs";
import preact from "@preact/preset-vite";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// The pages for customers, each its own entry without the CRM app.
const CUSTOMER_PAGES = ["abmelden", "termin"];

// The PWA plugin adds the manifest and the service worker registration to every page; the pages for
// customers must not install the CRM on their device.
function customerPagesWithoutApp(): Plugin {
  return {
    name: "customer-pages-without-app",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const name of CUSTOMER_PAGES) {
        const page = bundle[`${name}/index.html`];
        if (page?.type !== "asset" || typeof page.source !== "string") throw new Error(`${name}/index.html missing in the build`);
        page.source = page.source
          .replace(/<link rel="manifest"[^>]*>/, "")
          .replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/, "");
      }
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    rollupOptions: {
      // Pages for customers: opting out of follow-up mails, booking a proposed appointment.
      input: { main: "index.html", ...Object.fromEntries(CUSTOMER_PAGES.map((name) => [name, `${name}/index.html`])) },
    },
  },
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "fonts/*.woff2"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        globIgnores: CUSTOMER_PAGES.map((name) => `${name}/**`),
        navigateFallback: "/index.html",
        // The pages for customers are their own pages, never the app.
        navigateFallbackDenylist: CUSTOMER_PAGES.map((name) => new RegExp(`^/${name}/`)),
      },
      manifest: {
        name: "RepoCity CRM",
        short_name: "CRM",
        description: "Kunden, Angebote, Aufträge und Rechnungen",
        theme_color: "#04060B",
        background_color: "#04060B",
        display: "standalone",
        lang: "de",
        start_url: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
    }),
    customerPagesWithoutApp(),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
