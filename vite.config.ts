import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, type PluginOption } from 'vite';

const require = createRequire(import.meta.url);

// বাংলা মন্তব্য: vite-plugin-pwa প্যাকেজটি node_modules-এ থাকলে লোড হবে, না থাকলে নিরাপদ noop প্লাগইন ব্যবহৃত হবে।
function loadVitePwaPlugin(): ((options: Record<string, unknown>) => PluginOption) | null {
  try {
    const mod = require('vite-plugin-pwa') as {
      VitePWA?: (options: Record<string, unknown>) => PluginOption;
    };
    return typeof mod?.VitePWA === 'function' ? mod.VitePWA : null;
  } catch {
    return null;
  }
}

export default defineConfig(() => {
  const isTauriBuild = Boolean(process.env.TAURI_ENV_PLATFORM);
  const VitePWA = !isTauriBuild ? loadVitePwaPlugin() : null;

  return {
    base: isTauriBuild ? './' : '/',
    plugins: [
      react(),
      tailwindcss(),
      ...(VitePWA
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
      chunkSizeWarningLimit: 600,
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
            if (id.includes('node_modules/@google/genai')) return 'vendor-genai';
            if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) {
              return 'vendor-motion';
            }
            if (
              id.includes('node_modules/marked') ||
              id.includes('node_modules/dompurify') ||
              id.includes('node_modules/zod') ||
              id.includes('node_modules/qrcode')
            ) {
              return 'vendor-content';
            }
            if (id.includes('node_modules/three')) return 'vendor-three';
            if (
              id.includes('node_modules/recharts') ||
              id.includes('node_modules/d3-') ||
              id.includes('node_modules/d3/')
            ) {
              return 'vendor-charts';
            }
            if (id.includes('node_modules/@xterm')) return 'vendor-xterm';
            if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
            if (id.includes('/src/locales/')) return 'i18n-locales';
            if (
              id.includes('/src/data/themePresets') ||
              id.includes('/src/components/theme/LiveScreenBackdrop')
            ) {
              return 'theme-backdrops';
            }
            if (
              id.includes('/src/hooks/useLiveVoiceSession') ||
              id.includes('/src/utils/phpPreviewRuntime')
            ) {
              return 'workspace-runtimes';
            }
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
