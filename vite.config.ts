import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: 'dist/client', emptyOutDir: true, target: 'es2020', sourcemap: false },
  server: { proxy: { '/api': 'http://localhost:3000' } },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Inter-Diesel — Stock et ventes',
        short_name: 'Inter-Diesel',
        description: 'Stock, ventes et crédits clients, en ligne et hors ligne.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#0e2a47',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // The app shell is precached; the barcode WebAssembly (1 MB) is only fetched
        // on computers that need it, then kept for offline use.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['**/zxing*', '**/ponyfill*'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /zxing|ponyfill|\.wasm$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'scanner', expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
});
