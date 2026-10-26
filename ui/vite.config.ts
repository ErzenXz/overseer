import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In dev, the Go hub runs on :4200 and Vite proxies API traffic to it.
// OVERSEER_HUB points the dev UI at another hub, e.g. http://localhost:4301.
const hub = process.env.OVERSEER_HUB || 'http://localhost:4200'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: hub,
        ws: true,
      },
      '/install': hub,
      '/mcp': hub,
    },
  },
})
