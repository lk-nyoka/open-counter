import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

// `npm run dev` serves the app with hot reload. /api, /auth and /mcp go to OPEN_COUNTER_API: the local Worker
// (`npm run dev:local` in the repo root, port 8792) by default, or the live one.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.OPEN_COUNTER_API || 'http://localhost:8792';
  const proxy = Object.fromEntries(['/api', '/auth', '/mcp'].map((p) => [p, { target, changeOrigin: true }]));
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(__dirname, '.') } },
    server: { proxy },
  };
});
