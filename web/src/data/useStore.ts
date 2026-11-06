import { useSyncExternalStore } from 'react';
import { del, get, set } from 'idb-keyval';
import { Store, type KV } from './store';
import type { Op } from './types';

const idb: KV = {
  get: (k) => get(k),
  set: (k, v) => set(k, v),
  del: (k) => del(k)
};

export const store = new Store(idb);

export function useStore() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Commit ops from an action, turning action errors into a message for the caller. */
export function run(make: () => Op[]): string | null {
  try {
    store.commit(make());
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/* Keep in sync while the app is open: poll every 20 s when visible, sync on reconnect, save on hide. */
let started = false;
export function startBackgroundSync() {
  if (started) return;
  started = true;
  setInterval(() => {
    if (document.visibilityState === 'visible') store.syncSoon(0);
  }, 20000);
  window.addEventListener('online', () => store.syncSoon(0));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') store.syncSoon(0);
    else void store.saveNow();
  });
  window.addEventListener('pagehide', () => void store.saveNow());
}
