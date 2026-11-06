import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { devApi } from './dev/devApi.ts';

export default defineConfig({
  // Relative paths, so the build works at a domain root (Cloudflare Pages)
  // or under a sub-path (GitHub Pages: /shoppinglist/).
  base: './',
  plugins: [
    react(),
    devApi(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Aisle',
        short_name: 'Aisle',
        description: 'Weekly shopping list: plan at home, shop in store order.',
        theme_color: '#1E7F4F',
        background_color: '#F7F7F5',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html'
      }
    })
  ],
  test: {
    include: ['src/**/*.test.ts', 'dev/**/*.test.ts']
  }
});
