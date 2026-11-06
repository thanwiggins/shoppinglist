/**
 * A local stand-in for the Apps Script API, used by `npm run dev`.
 * It runs the same Core.js the real API runs, stores data in .dev-db.json,
 * and seeds itself by running the real migration on a legacy-sheet export.
 *
 *   Access key: dev     API address: /api
 *   AISLE_DEV_LEGACY=/path/to/legacy.json  seeds from a full export instead of the sample.
 */
import type { Plugin } from 'vite';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('../../apps-script/Core.js');

const DB_FILE = join(here, '..', '.dev-db.json');
const DEV_KEY = 'dev';

type Row = Record<string, unknown> & { id: string; _v: number };
type Db = { version: number; epoch: string; tableVersions: Record<string, number>; tables: Record<string, Record<string, Row>> };

/** Loads a legacy export ({Sheet: rows[][]}, dates as {__date}) into the shape coreMigrateLegacy wants. */
export function legacyFromExport(raw: Record<string, unknown[][]>) {
  const fix = (rows: unknown[][] = []) =>
    rows.map((r) => r.map((v) => (v && typeof v === 'object' && '__date' in v ? (v as { __date: string }).__date : v)));
  return {
    products: fix(raw['Products']),
    departments: fix(raw['Departments']),
    meals: fix(raw['Meals']),
    listBuilder: fix(raw['List Builder']),
    shoppingList: fix(raw['Shopping List']),
    dinnerdata: fix(raw['Dinnerdata'])
  };
}

function seed(): Db {
  const source = process.env.AISLE_DEV_LEGACY || join(here, 'sample-legacy.json');
  const legacy = legacyFromExport(JSON.parse(readFileSync(source, 'utf8')));
  const { tables, report } = core.coreMigrateLegacy(legacy, new Date().toISOString());
  const db: Db = core.coreEmptyDb();
  db.version = 1;
  db.epoch = 'dev-' + Date.now();
  for (const t of core.CORE_TABLES as string[]) {
    db.tables[t] = {};
    for (const row of tables[t] as Row[]) db.tables[t][row.id] = row;
    db.tableVersions[t] = 1;
  }
  console.log('[dev api] seeded from', source, report);
  return db;
}

function load(): Db {
  if (existsSync(DB_FILE)) return JSON.parse(readFileSync(DB_FILE, 'utf8'));
  const db = seed();
  save(db);
  return db;
}

function save(db: Db) {
  writeFileSync(DB_FILE, JSON.stringify(db));
}

/** Same request/response contract as apps-script/Api.js. */
export function handle(db: Db, body: { key?: string; action?: string; since?: number; ops?: unknown[]; epoch?: string }) {
  if (body.key !== DEV_KEY) return { ok: false, code: 'unauthorized', error: 'Wrong access key.' };
  if (body.action === 'ping') return { ok: true };
  if (body.action === 'bootstrap') return { ok: true, version: db.version, epoch: db.epoch, tables: core.coreSnapshot(db) };
  if (body.action === 'sync') {
    const since = Number(body.since) || 0;
    if (since > db.version || (body.epoch || '') !== (db.epoch || '')) {
      return { ok: true, reset: true, version: db.version, epoch: db.epoch, changes: {} };
    }
    core.coreApplyOps(db, body.ops || [], new Date().toISOString());
    return { ok: true, version: db.version, epoch: db.epoch, changes: core.coreChangesSince(db, since) };
  }
  return { ok: false, code: 'bad_request', error: 'Unknown action' };
}

export function devApi(): Plugin {
  return {
    name: 'aisle-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => {
          let out: unknown;
          try {
            const db = load();
            const delay = Number(process.env.AISLE_DEV_DELAY || 400); // feel like Apps Script
            out = handle(db, JSON.parse(data || '{}'));
            save(db);
            setTimeout(() => {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(out));
            }, delay);
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, code: 'error', error: String(e) }));
          }
        });
      });
    }
  };
}
