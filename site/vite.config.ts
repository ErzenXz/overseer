import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// A small multi-page site: each page is its own static HTML entry.
const pages = ["index", "features/index", "download/index", "security/index", "changelog/index"];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: Object.fromEntries(pages.map((page) => [page.replace("/index", "") || "index", resolve(__dirname, `${page}.html`)])),
    },
  },
});
