import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'EduVillage',
        short_name: 'EduVillage',
        description: 'Offline-First Low-Bandwidth Learning Platform',
        theme_color: '#0F5B57',
        background_color: '#FFFFFF',
        display: 'standalone',
        start_url: '/',
        orientation: 'portrait-primary',
        icons: [
          {
            src: '/favicon.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          },
          {
            src: '/favicon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        // Precache only the application shell (code, styles, icons). API responses are private and are
        // deliberately never cached by the service worker; offline content lives in IndexedDB instead.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        cleanupOutdatedCaches: true,
        // Any client-side route (e.g. /student/downloads) opens from the cached shell when offline,
        // but real API paths are never answered with index.html.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health/, /^\/ready/, /^\/docs/, /^\/openapi\.json/]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**']
  }
})
