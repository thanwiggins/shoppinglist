/**
 * The local-first store.
 *
 *   base     rows the server has confirmed
 *   inflight ops sent to the server, waiting for an answer
 *   outbox   ops made since, not yet sent
 *   view     base + inflight + outbox: what the screens show
 *
 * Every change lands in the view immediately; syncing happens in the background.
 * If a sync fails (offline, timeout) the ops go back to the front of the outbox and
 * are retried, so nothing is lost. Everything is saved on the device after each change.
 */
import { ApiError, bootstrap, fetchTransport, sync, type Config, type Transport } from './api';
import { applyOps, mergeServerRows } from './ops';
import { emptyTables, TABLES, type Op, type TableName, type Tables } from './types';

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface Snapshot {
  ready: boolean;
  config: Config | null;
  hasData: boolean;
  view: Tables;
  pending: number;
  syncState: SyncState;
  syncError: string;
  lastSyncAt: number | null;
}

interface Persisted {
  base: Tables;
  version: number;
  epoch: string;
  outbox: Op[];
  lastSyncAt: number | null;
}

const STATE_KEY = 'aisle-state-v1';
const CONFIG_KEY = 'aisle-config-v1';

export class Store {
  private base: Tables = emptyTables();
  private version = 0;
  private epoch = '';
  private outbox: Op[] = [];
  private inflight: Op[] = [];
  private config: Config | null = null;
  private hasData = false;
  private ready = false;
  private syncState: SyncState = 'idle';
  private syncError = '';
  private lastSyncAt: number | null = null;
  private view: Tables = emptyTables();
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private syncAgain = false;
  private failures = 0;

  constructor(private kv: KV, private transport: Transport = fetchTransport) {
    this.snapshot = this.makeSnapshot();
  }

  /* ---- React binding ---- */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = this.makeSnapshot();
    this.listeners.forEach((l) => l());
  }

  private makeSnapshot(): Snapshot {
    return {
      ready: this.ready,
      config: this.config,
      hasData: this.hasData,
      view: this.view,
      pending: this.outbox.length + this.inflight.length,
      syncState: this.syncState,
      syncError: this.syncError,
      lastSyncAt: this.lastSyncAt
    };
  }

  /* ---- Lifecycle ---- */
  private initStarted = false;

  async init() {
    if (this.initStarted) return;
    this.initStarted = true;
    this.config = (await this.kv.get<Config>(CONFIG_KEY)) ?? null;
    const saved = await this.kv.get<Persisted>(STATE_KEY);
    if (saved) {
      this.base = { ...emptyTables(), ...saved.base };
      this.version = saved.version;
      this.epoch = saved.epoch;
      this.outbox = saved.outbox ?? [];
      this.lastSyncAt = saved.lastSyncAt ?? null;
      this.hasData = true;
    }
    this.view = applyOps(this.base, this.outbox);
    this.ready = true;
    this.emit();
    if (this.config) {
      if (!this.hasData) await this.download().catch(() => undefined);
      else this.syncSoon(0);
    }
  }

  /** Saves the connection and downloads everything. Throws if the server refuses. */
  async connect(config: Config) {
    const res = await bootstrap(this.transport, config);
    this.config = config;
    await this.kv.set(CONFIG_KEY, config);
    this.outbox = [];
    this.loadSnapshot(res.tables, res.version, res.epoch);
  }

  async disconnect() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.config = null;
    this.base = emptyTables();
    this.view = emptyTables();
    this.outbox = [];
    this.inflight = [];
    this.version = 0;
    this.epoch = '';
    this.hasData = false;
    this.lastSyncAt = null;
    await this.kv.del(CONFIG_KEY);
    await this.kv.del(STATE_KEY);
    this.emit();
  }

  /** Throws away the device copy and downloads everything again (unsent changes are kept and re-sent). */
  async download() {
    if (!this.config) return;
    this.setSync('syncing');
    try {
      const res = await bootstrap(this.transport, this.config);
      this.loadSnapshot(res.tables, res.version, res.epoch);
      this.setSync('idle');
      if (this.outbox.length) this.syncSoon(0);
    } catch (e) {
      this.fail(e);
      throw e;
    }
  }

  private loadSnapshot(tables: Partial<Record<TableName, Array<{ id: string }>>>, version: number, epoch: string) {
    const base = emptyTables();
    for (const name of TABLES) {
      const rec: Record<string, unknown> = {};
      for (const row of tables[name] ?? []) rec[row.id] = row;
      (base as Record<string, unknown>)[name] = rec;
    }
    this.base = base;
    this.version = version;
    this.epoch = epoch;
    this.hasData = true;
    this.lastSyncAt = Date.now();
    this.view = applyOps(this.base, [...this.inflight, ...this.outbox]);
    this.saveSoon(0);
    this.emit();
  }

  /* ---- Changes ---- */
  commit(ops: Op[]) {
    if (!ops.length) return;
    this.outbox.push(...ops);
    this.view = applyOps(this.view, ops);
    this.emit();
    this.saveSoon();
    this.syncSoon();
  }

  /** Drops changes the server keeps refusing, so syncing can continue. */
  discardPending() {
    this.outbox = [];
    this.view = applyOps(this.base, this.inflight);
    this.setSync('idle');
    this.saveSoon(0);
    this.syncSoon(0);
  }

  /* ---- Sync ---- */
  syncSoon(delay = 800) {
    if (!this.config) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncNow();
    }, delay);
  }

  async syncNow() {
    if (!this.config) return;
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    this.syncing = true;
    this.inflight = this.outbox;
    this.outbox = [];
    this.setSync('syncing');
    try {
      const res = await sync(this.transport, this.config, this.version, this.epoch, this.inflight);
      if (res.reset || (res.epoch || '') !== (this.epoch || '')) {
        // The data was re-copied on the server: pending ops point at rows that no longer exist.
        this.inflight = [];
        this.outbox = [];
        const fresh = await bootstrap(this.transport, this.config);
        this.loadSnapshot(fresh.tables, fresh.version, fresh.epoch);
      } else {
        this.base = mergeServerRows(this.base, res.changes);
        this.version = res.version;
        this.epoch = res.epoch || this.epoch;
        this.inflight = [];
        this.view = applyOps(this.base, this.outbox);
        this.lastSyncAt = Date.now();
      }
      this.failures = 0;
      this.setSync('idle');
    } catch (e) {
      this.outbox = [...this.inflight, ...this.outbox];
      this.inflight = [];
      this.fail(e);
    } finally {
      this.syncing = false;
      this.saveSoon(0);
      this.emit();
      if (this.syncState === 'idle' && (this.syncAgain || this.outbox.length)) {
        this.syncAgain = false;
        this.syncSoon(300);
      } else if (this.syncState === 'offline') {
        // Back off: 2s, 4s, 8s ... up to a minute.
        this.syncSoon(Math.min(60000, 2000 * 2 ** Math.min(this.failures - 1, 5)));
      }
    }
  }

  private fail(e: unknown) {
    this.failures += 1;
    if (e instanceof ApiError && e.code !== 'http' && e.code !== 'error') {
      this.syncError = e.message;
      this.setSync('error');
    } else {
      this.syncError = navigator.onLine === false ? 'No connection' : 'Could not reach the server';
      this.setSync('offline');
    }
  }

  private setSync(state: SyncState) {
    this.syncState = state;
    if (state !== 'error' && state !== 'offline') this.syncError = '';
    this.emit();
  }

  /* ---- Saving on the device ---- */
  private saveSoon(delay = 300) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, delay);
  }

  async saveNow() {
    if (!this.hasData) return;
    const state: Persisted = {
      base: this.base,
      version: this.version,
      epoch: this.epoch,
      outbox: [...this.inflight, ...this.outbox],
      lastSyncAt: this.lastSyncAt
    };
    await this.kv.set(STATE_KEY, state);
  }
}
