import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In dev, the Go hub runs on :4200 and Vite proxies API traffic to it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4200',
        ws: true,
      },
      '/install': 'http://localhost:4200',
    },
  },
})
