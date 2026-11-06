// Cross-tab save coordination: every doc save announces itself on a
// shared channel so a second open tab can pull the newer workspace
// instead of silently overwriting it. BroadcastChannel covers every
// adapter; the localStorage 'storage' event is the fallback, which
// only fires for the localStorage adapter, but engines without
// BroadcastChannel cannot run the sqlite one anyway.
const CHANNEL = 'scatterboard:doc';
const LS_KEY = 'scatterboard:v1';

export interface TabSync {
  // Called after a successful full-doc adapter save.
  notifySaved(): void;
}

export function initTabSync(onForeignSave: () => void): TabSync {
  const tab = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  let ch: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => {
      if ((e.data as { tab?: string } | null)?.tab !== tab) onForeignSave();
    };
  } else {
    window.addEventListener('storage', (e: StorageEvent) => {
      if (e.key === LS_KEY) onForeignSave();
    });
  }
  return {
    notifySaved() {
      ch?.postMessage({ tab });
    },
  };
}
