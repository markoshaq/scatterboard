import { defineConfig } from 'vite';

export default defineConfig({
  // PLANBOARD_BASE kept for existing deploy scripts.
  base: process.env.SCATTERBOARD_BASE ?? process.env.PLANBOARD_BASE ?? './',
  define: {
    __BUILD_ID__: JSON.stringify(String(Date.now())),
  },
  build: {
    target: 'es2022',
    sourcemap: 'hidden',
  },
});
