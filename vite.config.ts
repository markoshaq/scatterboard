import { defineConfig } from 'vite';
import pkg from './package.json';

export default defineConfig({
  base: process.env.SCATTERBOARD_BASE ?? './',
  define: {
    __BUILD_ID__: JSON.stringify(String(Date.now())),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    sourcemap: 'hidden',
  },
});
