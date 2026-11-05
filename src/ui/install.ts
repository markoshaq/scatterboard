// Install affordance for the PWA path. Chrome/Edge fire
// beforeinstallprompt once the app is installable; the event is stashed
// here so Help > Install app can trigger it on demand. iOS Safari never
// fires it, so the About popup documents Share > Add to Home Screen.
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;

export function initInstallCapture() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
  });
}

export function installAvailable(): boolean {
  return deferred !== null;
}

export function runInstall() {
  const d = deferred;
  deferred = null;
  void d?.prompt();
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 0);
}

export function inStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}
