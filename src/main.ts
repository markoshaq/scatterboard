import './style.css';
import { bootLang, loadLang } from './strings';
import { initInstallCapture } from './ui/install';

async function main() {
  // Capture early: beforeinstallprompt can fire before boot finishes.
  initInstallCapture();
  // The active locale table must land before the app modules evaluate:
  // several modules capture t() output in module-level label tables.
  await loadLang(bootLang());
  document.documentElement.lang = bootLang();
  const { boot } = await import('./boot');
  await boot();
}
void main();

// PWA: production builds register the cache-first service worker so the
// shell (and lazily every hashed asset) works fully offline.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`./sw.js?v=${__BUILD_ID__}`).catch(() => {});
  });
}
