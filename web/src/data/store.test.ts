import { describe, expect, it } from 'vitest';
import { handle } from '../../dev/devApi';
import { core, productId, sampleDb } from '../test/helpers';
import type { Transport } from './api';
import { ensureTrip } from './actions';
import { upsert } from './ops';
import { currentTrip } from './selectors';
import { Store, type KV } from './store';

function memoryKv(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (k) => structuredClone(data.get(k)) as never,
    set: async (k, v) => { data.set(k, structuredClone(v)); },
    del: async (k) => { data.delete(k); }
  };
}

/** A transport backed by the dev API (the same Core.js logic the real server runs). */
function server() {
  const db = sampleDb();
  let online = true;
  let hold: (() => void) | null = null;
  const transport: Transport = async (config, body) => {
    if (!online) throw new TypeError('Failed to fetch');
    const payload = JSON.parse(JSON.stringify({ ...body, key: config.key }));
    if (hold) await new Promise<void>((r) => { const h = hold!; hold = () => { h(); r(); }; });
    return JSON.parse(JSON.stringify(handle(db as never, payload)));
  };
  return {
    db, transport,
    setOnline: (v: boolean) => { online = v; },
    pause: () => { let release!: () => void; const p = new Promise<void>((r) => (release = r)); hold = () => { void p; }; return () => { const h = hold; hold = null; h?.(); release(); }; }
  };
}

const config = { apiUrl: '/api', key: 'dev' };

describe('Store', () => {
  it('downloads, then keeps changes made offline and sends them when back online', async () => {
    const s = server();
    const kv = memoryKv();
    const store = new Store(kv, s.transport);
    await store.init();
    await store.connect(config);
    const view = store.getSnapshot().view;
    const milk = productId(view, 'Milk');

    s.setOnline(false);
    store.commit([upsert('products', milk, { price: 3.25 })]);
    expect(store.getSnapshot().view.products[milk].price).toBe(3.25); // instant
    await store.syncNow();
    expect(store.getSnapshot().syncState).toBe('offline');
    expect(store.getSnapshot().pending).toBe(1);
    expect(s.db.tables.products[milk].price).toBe(3);

    s.setOnline(true);
    await store.syncNow();
    expect(store.getSnapshot().pending).toBe(0);
    expect(store.getSnapshot().syncState).toBe('idle');
    expect(s.db.tables.products[milk].price).toBe(3.25);
    expect(store.getSnapshot().view.products[milk].price).toBe(3.25);
  });

  it('survives a restart with unsent changes', async () => {
    const s = server();
    const kv = memoryKv();
    const a = new Store(kv, s.transport);
    await a.init();
    await a.connect(config);
    const milk = productId(a.getSnapshot().view, 'Milk');
    s.setOnline(false);
    a.commit([upsert('products', milk, { price: 4 })]);
    await a.saveNow();

    const b = new Store(kv, s.transport);
    await b.init();
    expect(b.getSnapshot().view.products[milk].price).toBe(4);
    expect(b.getSnapshot().pending).toBe(1);
    s.setOnline(true);
    await b.syncNow();
    expect(s.db.tables.products[milk].price).toBe(4);
  });

  it('picks up changes made on another device', async () => {
    const s = server();
    const phone = new Store(memoryKv(), s.transport);
    const laptop = new Store(memoryKv(), s.transport);
    await phone.init(); await phone.connect(config);
    await laptop.init(); await laptop.connect(config);
    const bread = productId(phone.getSnapshot().view, 'Bread');
    laptop.commit([upsert('products', bread, { price: 2.75 })]);
    await laptop.syncNow();
    await phone.syncNow();
    expect(phone.getSnapshot().view.products[bread].price).toBe(2.75);
  });

  it('keeps edits made while a sync is in flight', async () => {
    const s = server();
    const store = new Store(memoryKv(), s.transport);
    await store.init(); await store.connect(config);
    const view = store.getSnapshot().view;
    const milk = productId(view, 'Milk');
    const bread = productId(view, 'Bread');
    store.commit([upsert('products', milk, { price: 5 })]);
    const release = s.pause();
    const inflight = store.syncNow();
    store.commit([upsert('products', bread, { price: 9 })]); // tapped while waiting
    release();
    await inflight;
    expect(store.getSnapshot().view.products[bread].price).toBe(9);
    expect(store.getSnapshot().view.products[milk].price).toBe(5);
    await store.syncNow();
    expect(s.db.tables.products[bread].price).toBe(9);
  });

  it('starts over when the server data was re-copied', async () => {
    const s = server();
    const store = new Store(memoryKv(), s.transport);
    await store.init(); await store.connect(config);
    s.db.epoch = 'e2';
    await store.syncNow();
    expect(store.getSnapshot().syncState).toBe('idle');
    expect(store.getSnapshot().hasData).toBe(true);
  });

  it('switches to the real data when the first copy happens after a device connected', async () => {
    const s = server();
    const empty = core.coreEmptyDb();
    Object.assign(s.db, { ...empty, tables: Object.fromEntries((core.CORE_TABLES as string[]).map((t) => [t, {}])) });
    const store = new Store(memoryKv(), s.transport);
    await store.init(); await store.connect(config);
    store.commit(ensureTrip(store.getSnapshot().view)); // the app makes a blank week on an empty sheet
    await store.syncNow();
    expect(s.db.version).toBe(1);

    // The data copy runs on the server: every table replaced, one version later, new epoch.
    const copied = sampleDb();
    copied.version = 2;
    for (const t of core.CORE_TABLES as string[]) {
      copied.tableVersions[t] = 2;
      for (const row of Object.values(copied.tables[t]) as { _v: number }[]) row._v = 2;
    }
    Object.assign(s.db, copied);
    await store.syncNow();
    const view = store.getSnapshot().view;
    expect(Object.keys(view.products).length).toBeGreaterThan(0);
    expect(Object.keys(view.trips)).toHaveLength(1); // the blank week is gone
    expect(currentTrip(view)!.id).toBe(Object.keys(copied.tables.trips)[0]);
  });

  it('reports a wrong key instead of retrying forever', async () => {
    const s = server();
    const store = new Store(memoryKv(), s.transport);
    await expect(store.connect({ apiUrl: '/api', key: 'nope' })).rejects.toThrow('Wrong access key');
  });
});
