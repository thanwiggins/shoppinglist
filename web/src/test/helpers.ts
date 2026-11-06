import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { legacyFromExport } from '../../dev/devApi';
import { emptyTables, TABLES, type Tables } from '../data/types';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
export const core = require('../../../apps-script/Core.js');

export function sampleLegacy() {
  return legacyFromExport(JSON.parse(readFileSync(join(here, '../../dev/sample-legacy.json'), 'utf8')));
}

/** The sample sheet, migrated, as the client sees it. */
export function sampleView(): Tables {
  const { tables } = core.coreMigrateLegacy(sampleLegacy(), '2026-11-06T12:00:00.000Z');
  const view = emptyTables();
  for (const t of TABLES) {
    const rec: Record<string, unknown> = {};
    for (const row of tables[t]) rec[row.id] = row;
    (view as Record<string, unknown>)[t] = rec;
  }
  return view;
}

/** A server db (as the dev API keeps it) seeded with the sample. */
export function sampleDb() {
  const { tables } = core.coreMigrateLegacy(sampleLegacy(), '2026-11-06T12:00:00.000Z');
  const db = core.coreEmptyDb();
  db.version = 1;
  db.epoch = 'e1';
  for (const t of core.CORE_TABLES as string[]) {
    db.tables[t] = {};
    for (const row of tables[t]) db.tables[t][row.id] = row;
    db.tableVersions[t] = 1;
  }
  return db;
}

export const productId = (t: Tables, name: string) => {
  const p = Object.values(t.products).find((x) => x.name === name);
  if (!p) throw new Error('no product ' + name);
  return p.id;
};
export const sectionId = (t: Tables, name: string) => Object.values(t.sections).find((s) => s.name === name)!.id;
export const mealId = (t: Tables, name: string) => Object.values(t.meals).find((m) => m.name === name)!.id;
