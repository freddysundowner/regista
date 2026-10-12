import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
// @ts-expect-error plain JS module shared with the API build
import { appName, rebrand } from '../../brand.config.mjs';

/** Swaps the product name (APP_NAME) into the app's own source and the page shell. See brand.config.mjs. */
function brandName(): Plugin {
  const name: string = appName();
  return {
    name: 'brand-name',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0];
      if (file.includes('/node_modules/') || !/\.(tsx?|mjs)$/.test(file)) return null;
      const out: string = rebrand(code, name);
      return out === code ? null : { code: out, map: null };
    },
    transformIndexHtml: (html) => rebrand(html, name),
  };
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    brandName(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      // Keep the browser's Host header so the API's same-origin (CSRF) check matches the Origin.
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 8080}`, changeOrigin: false },
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
