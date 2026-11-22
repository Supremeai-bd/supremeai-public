import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  const isTauriBuild = Boolean(process.env.TAURI_ENV_PLATFORM);

  return {
    base: isTauriBuild ? './' : '/',
    plugins: [
      react(),
      tailwindcss(),
      ...(!isTauriBuild
        ? [
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
              manifest: {
                id: '/',
                name: 'SupremeAI Studio',
                short_name: 'SupremeAI',
                description:
                  'Ultra-light, high-performance bilingual AI workspace and developer studio powered by SupremeAI models.',
                theme_color: '#0f172a',
                background_color: '#020617',
                display: 'standalone',
                start_url: '/',
                scope: '/',
                icons: [
                  {
                    src: '/pwa-192x192.png',
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: '/pwa-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: '/pwa-maskable-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
              },
              workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,woff,woff2}'],
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
                navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
                runtimeCaching: [
                  {
                    urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'google-fonts-cache',
                      expiration: {
                        maxEntries: 10,
                        maxAgeSeconds: 60 * 60 * 24 * 365,
                      },
                      cacheableResponse: {
                        statuses: [0, 200],
                      },
                    },
                  },
                  {
                    urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'gstatic-fonts-cache',
                      expiration: {
                        maxEntries: 10,
                        maxAgeSeconds: 60 * 60 * 24 * 365,
                      },
                      cacheableResponse: {
                        statuses: [0, 200],
                      },
                    },
                  },
                ],
              },
              devOptions: {
                enabled: true,
                type: 'module',
              },
            }),
          ]
        : [
            {
              name: 'tauri-pwa-noop',
              resolveId(id: string) {
                if (id === 'virtual:pwa-register') return '\0virtual:pwa-register';
              },
              load(id: string) {
                if (id === '\0virtual:pwa-register') return 'export function registerSW() { return () => {}; }';
              },
            },
          ]),
    ],
    clearScreen: false,
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/scheduler/')
            ) {
              return 'vendor-react';
            }
            if (id.includes('node_modules/firebase/') || id.includes('node_modules/@firebase/')) {
              return 'vendor-firebase';
            }
            if (id.includes('node_modules/three')) return 'vendor-three';
            if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
              return 'vendor-charts';
            }
            if (id.includes('node_modules/@xterm')) return 'vendor-xterm';
            if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
